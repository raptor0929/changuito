/**
 * The only module in this app that opens a Postgres connection.
 *
 * Everything the money path needs to remember now lives here rather than in
 * Redis, and the reason is not preference. A card the customer keeps has no
 * expiry, and a binding with no expiry does not belong in a cache with an
 * eviction policy: `SET NX` gives atomicity but Redis can still drop the key
 * under memory pressure, at which point the next deposit mints a second card
 * for somebody who already has one. A primary key cannot be evicted.
 *
 * Redis is still the right home for what remains there — the agent's in-flight
 * turn and the local-model breaker are genuine cache workloads, read many times
 * a turn, and both already degrade safely (CLAUDE.md §4). What left Redis is
 * the part where being wrong costs a shopper money.
 *
 * ## Three things about this connection specifically
 *
 * `prepare: false` is not optional. Supabase's pooler rejects named prepared
 * statements, and the failure is a confusing "prepared statement already
 * exists" on the *second* request rather than the first.
 *
 * `max: 1` because a lambda handles one request at a time; a larger pool just
 * holds connections open against the pooler's own limit.
 *
 * The connection is created lazily and cached on the module. A fresh clone with
 * no DATABASE_URL should still boot and still serve the chat half of the app —
 * the same degrade lib/pollar.ts makes for a missing wallet key — so nothing
 * here throws at import time. It throws when a money path actually needs a
 * database and there is none, which is a state that must be loud.
 */
import postgres from 'postgres';

import type { NetworkId } from './deployments.ts';

export type Sql = ReturnType<typeof postgres>;

let cached: Sql | undefined;

/** Whether this deployment has a database at all. */
export function hasDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.DATABASE_URL ?? '').trim());
}

/**
 * The pooled connection, made once.
 *
 * DATABASE_URL is the transaction pooler (6543). DIRECT_URL (5432) is for
 * migrations only and is deliberately not read here: transaction-mode pooling
 * is what makes a lambda-per-request workload survivable, and a route that
 * quietly opened a session connection would exhaust the database under load
 * rather than at deploy.
 */
export function db(env: NodeJS.ProcessEnv = process.env): Sql {
  if (cached) return cached;
  const url = (env.DATABASE_URL ?? '').trim();
  if (!url) {
    // Reached only from a money path. The message names the variable because
    // the person reading this log is the person who can set it.
    throw new Error('DATABASE_URL is not set — the card and order tables are unreachable.');
  }
  cached = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    // A serverless function is killed, not shut down. Logging a fetch of a
    // closed connection as an error would be noise on every cold start.
    onnotice: () => {},
  });
  return cached;
}

/** Tests only: drop the cached connection so a fake can take its place. */
export function resetDb(next?: Sql): void {
  cached = next;
}

/* ---- the card a customer keeps ------------------------------------------ */

/**
 * The customer's card, or nothing if they have never been issued one.
 *
 * Keyed on (network, address) rather than address alone, so a testnet card
 * funded with play money can never be the one a mainnet deposit tops up.
 */
export async function cardOf(net: NetworkId, address: string): Promise<string | undefined> {
  const rows = await db()`
    select card_id from card_owner where network = ${net} and address = ${address}`;
  return rows[0]?.card_id as string | undefined;
}

/**
 * Bind a freshly created card to a customer, once.
 *
 * Returns the id that ended up bound, which is **not always the one passed in**.
 * Two lambdas can reach `createCard` concurrently for the same wallet — the
 * deposit watcher and a refreshed tab, say — and both will hold a real card
 * from Vyrion. `on conflict do nothing` lets exactly one of them win, and the
 * loser learns it lost by getting back an id that is not theirs. The caller
 * must then terminate the card it created, or the customer is charged for two.
 *
 * That is the same losing-race shape app/api/card/route.ts already implements
 * for the per-deposit claim, and it is here rather than there because the
 * atomicity is a property of the constraint.
 */
export async function bindCard(net: NetworkId, address: string, cardId: string): Promise<string> {
  const sql = db();
  const inserted = await sql`
    insert into card_owner (network, address, card_id)
    values (${net}, ${address}, ${cardId})
    on conflict (network, address) do nothing
    returning card_id`;
  if (inserted[0]) return inserted[0].card_id as string;
  const held = await cardOf(net, address);
  // No row after a conflict means it was deleted between the two statements —
  // a card terminated at exactly the wrong moment. Ours is as good as any.
  return held ?? cardId;
}

/**
 * Forget a card that Vyrion says is gone.
 *
 * Guarded on card_id so a stale read cannot unbind a card the customer was
 * issued after the one being forgotten.
 */
export async function unbindCard(net: NetworkId, address: string, cardId: string): Promise<void> {
  await db()`
    delete from card_owner
     where network = ${net} and address = ${address} and card_id = ${cardId}`;
}

/* ---- orders -------------------------------------------------------------- */

export type OrderStatus = 'quoted' | 'paid' | 'carded' | 'done' | 'failed';

export interface OrderRow {
  chatId: string;
  network: NetworkId;
  memo: string;
  address: string;
  status: OrderStatus;
  amountCents: number;
  arsQuoted: number | null;
  cardId: string | null;
  txHash: string | null;
  cartId: string | null;
  handoffUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toOrder = (r: Record<string, unknown>): OrderRow => ({
  chatId: r.chat_id as string,
  network: r.network as NetworkId,
  memo: r.memo as string,
  address: r.address as string,
  status: r.status as OrderStatus,
  amountCents: r.amount_cents as number,
  arsQuoted: (r.ars_quoted as number | null) ?? null,
  cardId: (r.card_id as string | null) ?? null,
  txHash: (r.tx_hash as string | null) ?? null,
  cartId: (r.cart_id as string | null) ?? null,
  handoffUrl: (r.handoff_url as string | null) ?? null,
  createdAt: r.created_at as Date,
  updatedAt: r.updated_at as Date,
});

/**
 * Open an order when the deposit intent is minted.
 *
 * This is where `rememberDepositor` used to write, and it records the same
 * fact: this memo was issued to a wallet the gate let through. What it adds is
 * that the fact no longer expires after 24 hours, so a deposit confirmed late
 * cannot become an unowned memo.
 *
 * `on conflict (chat_id) do update` because a shopper who re-quotes the same
 * basket is amending their order, not opening a second one — and chat_id being
 * the primary key is what makes "one order per chat" a fact rather than a hope.
 */
export async function openOrder(o: {
  chatId: string;
  network: NetworkId;
  memo: string;
  address: string;
  amountCents: number;
  arsQuoted?: number | null;
  cartId?: string | null;
}): Promise<OrderRow> {
  const rows = await db()`
    insert into orders (chat_id, network, memo, address, amount_cents, ars_quoted, cart_id)
    values (${o.chatId}, ${o.network}, ${o.memo}, ${o.address},
            ${o.amountCents}, ${o.arsQuoted ?? null}, ${o.cartId ?? null})
    on conflict (chat_id) do update
       set memo         = excluded.memo,
           amount_cents = excluded.amount_cents,
           ars_quoted   = excluded.ars_quoted,
           cart_id      = excluded.cart_id,
           status       = 'quoted'
    returning *`;
  return toOrder(rows[0]);
}

/** The order a memo belongs to, if any. */
export async function orderByMemo(net: NetworkId, memo: string): Promise<OrderRow | undefined> {
  const rows = await db()`
    select * from orders where network = ${net} and memo = ${memo}`;
  return rows[0] ? toOrder(rows[0]) : undefined;
}

/**
 * Claim this deposit for a card, exactly once.
 *
 * The conditional update is the whole guarantee, and it is the same one Redis
 * `SET NX` gave: `card_id is null` in the WHERE means two concurrent writers
 * cannot both match, because the first one's commit makes the second's
 * predicate false. An empty result is not an error — it means somebody else
 * claimed it, and `existing` says who with.
 *
 * Unlike the Redis version this leaves a row behind afterwards, so "which
 * deposit paid for which card" is answerable a month later.
 */
export async function claimOrder(
  net: NetworkId,
  memo: string,
  cardId: string,
): Promise<{ claimed: boolean; existing?: string }> {
  const sql = db();
  const won = await sql`
    update orders set card_id = ${cardId}, status = 'carded'
     where network = ${net} and memo = ${memo} and card_id is null
     returning card_id`;
  if (won[0]) return { claimed: true };
  const held = await orderByMemo(net, memo);
  return { claimed: false, existing: held?.cardId ?? undefined };
}

export async function markOrder(
  net: NetworkId,
  memo: string,
  status: OrderStatus,
  extra: { txHash?: string; handoffUrl?: string } = {},
): Promise<void> {
  await db()`
    update orders
       set status      = ${status},
           tx_hash     = coalesce(${extra.txHash ?? null}, tx_hash),
           handoff_url = coalesce(${extra.handoffUrl ?? null}, handoff_url)
     where network = ${net} and memo = ${memo}`;
}

/** A customer's orders, newest first, for /mis-compras. */
export async function ordersOf(net: NetworkId, address: string, limit = 50): Promise<OrderRow[]> {
  const rows = await db()`
    select * from orders
     where network = ${net} and address = ${address}
     order by created_at desc
     limit ${limit}`;
  return rows.map(toOrder);
}

/* ---- chat ---------------------------------------------------------------- */

/**
 * Save a conversation.
 *
 * `transcript` is `encodeTurn()`'s output and nothing else. Do not build that
 * object here or anywhere else: `RenderCache.products` is a `Map`, and
 * `JSON.stringify` renders a Map as `{}` with no error at all, so a hand-rolled
 * shape loses every product silently and only shows it on rehydration. The
 * `v: 1` codec in lib/agent/turn-store.ts exists for exactly that, and the same
 * encoded object goes into `jsonb` that goes into Redis today.
 *
 * Called only after a clean return, which is the rule turn-store.ts already
 * keeps: a turn that threw mid-hop can leave an assistant `tool_use` with no
 * matching `tool_result`, and the API rejects that pairing on the *next*
 * request — so persisting it would surface the failure one turn later, on a
 * turn that did nothing wrong.
 */
export async function saveChat(c: {
  id: string;
  network: NetworkId;
  address: string;
  title?: string | null;
  transcript: unknown;
}): Promise<void> {
  await db()`
    insert into chat (id, network, address, title, transcript)
    values (${c.id}, ${c.network}, ${c.address}, ${c.title ?? null},
            ${db().json(c.transcript as never)})
    on conflict (id) do update
       set transcript = excluded.transcript,
           title      = coalesce(chat.title, excluded.title)`;
}

/**
 * Read a conversation back — **only for the wallet that owns it**.
 *
 * The address is part of the WHERE rather than something the caller checks
 * afterwards. A chat id is a UUID, not a capability: guessing one should get
 * you nothing, and the way to guarantee that is for the query to be incapable
 * of returning somebody else's row.
 */
export async function loadChat(
  id: string,
  address: string,
): Promise<{ transcript: unknown; network: NetworkId } | undefined> {
  const rows = await db()`
    select transcript, network from chat where id = ${id} and address = ${address}`;
  if (!rows[0]) return undefined;
  return { transcript: rows[0].transcript, network: rows[0].network as NetworkId };
}

/** A customer's conversations, newest first, for the orders list to join on. */
export async function chatsOf(
  net: NetworkId,
  address: string,
  limit = 50,
): Promise<{ id: string; title: string | null; updatedAt: Date }[]> {
  const rows = await db()`
    select id, title, updated_at from chat
     where network = ${net} and address = ${address}
     order by updated_at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    updatedAt: r.updated_at as Date,
  }));
}
