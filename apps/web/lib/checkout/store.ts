import { hasDatabase } from '../db.ts';
import { kvGet, kvSet } from '../kv.ts';
import { db } from '../db.ts';
import type { ManualState } from './manual-policy.ts';

/**
 * A checkout between the quote and the settle: what the shopper was quoted,
 * which sandbox job is buying it, and how it ended.
 *
 * Same shape as lib/agent/turn-store.ts: the `kv` table when DATABASE_URL is
 * set, an in-process Map when not, so a fresh clone runs. The Map lives on
 * `globalThis` because Next compiles each route into its own bundle, and
 * /quote, /start and /[orderId] must see the same one.
 *
 * Losing a record is survivable: the escrow holds the money, not this store,
 * and the buyer can refund on chain after the deadline without us.
 */
export interface CheckoutRecord {
  checkoutKind?: 'manual_fee_v1';
  orderNonce?: string;
  manual?: ManualState;
  /** Chosen at start and kept for this order. A later config flip does not move it. */
  manualFlow?: 'viewer' | 'guided' | 'headless';
  /** Hex of the 32-byte order id. */
  orderId: string;
  buyer: string;
  /** USDC base units the order must lock, as a decimal string. */
  amount: string;
  /** US cents, for display. */
  amountCents: number;
  /** Hex. */
  basketHash: string;
  arsPerUsd: number;
  rateSource?: string;
  /** Envío quoted at `postalCode`, in centavos; part of `amount`. */
  shippingCentavos?: number;
  /** Where the shopper browsed: the sandbox delivers here when their Día account has no saved address. */
  postalCode?: string;
  /** Pesos as the shopper saw them. */
  totalDisplay: string;
  retailer: string;
  lines: { name: string; skuId: string; quantity: number; lineTotal: string }[];
  /** The shopper's own cart link at the store. */
  handoffUrl: string | null;
  createdAt: number;
  /** What the quote decided (lib/shared-card.ts `checkoutMode`). Absent on records from before it existed. */
  mode?: 'live' | 'demo' | 'mock';

  jobId?: string;
  /**
   * Base64 of the `open` message the server built for this order, with the
   * resolver as fee payer. The resolver co-signs exactly these bytes and
   * nothing else: its key pays the fee, so it must not sign whatever the
   * browser sends back.
   */
  openMessage?: string;
  /** Server-derived transaction identity, persisted before broadcasting. Not proof of funding. */
  openAttemptSig?: string;
  openSig?: string;
  /** Last phase the sandbox reported. */
  phase?: string;
  outcome?: 'settled' | 'refunded';
  closeSig?: string;
  /** The store's cart id the sandbox bought with: evidence, never shown as a link. */
  storeOrderForm?: string;
  /** What the store answered to the card: placed, declined, not_attempted, error. */
  payment?: string;
  /** Día's order number, when the order was placed. */
  storeOrderId?: string;
  error?: string;
  /** When the sandbox job was started (ms). The stuck alert counts from here. */
  startedAt?: number;
  /** Failed settle/refund attempts by the resolver, for the alert (lib/checkout/resolver-alert.ts). */
  closeFailures?: number;
  /** Which alert has already been logged server-side, so a poll every 3 s logs it once. */
  alertLogged?: 'resolver_failed' | 'stuck';
}

const TTL_SECONDS = 60 * 60 * 24;
const KEY = (orderId: string) => `checkout:${orderId}`;
const BUYER_KEY = (buyer: string) => `checkout-buyer:${buyer}`;

interface Store {
  get(orderId: string): Promise<CheckoutRecord | undefined>;
  set(rec: CheckoutRecord): Promise<void>;
  listByBuyer(buyer: string): Promise<CheckoutRecord[]>;
}

function postgresStore(): Store {
  return {
    async get(orderId) {
      const legacy = (await kvGet(KEY(orderId))) as CheckoutRecord | undefined;
      if (legacy) return legacy;
      // Manual orders have no cache expiry. During a rolling migration a missing
      // table must not break legacy lookups, but manual writes still fail closed.
      try {
        const rows = await db()`select record from manual_checkout where order_id=${orderId}`;
        return rows[0]?.record as CheckoutRecord | undefined;
      } catch (err) {
        if ((err as { code?: string }).code === '42P01') return undefined;
        throw err;
      }
    },
    async listByBuyer(buyer) {
      let manual: CheckoutRecord[] = [];
      try {
        const rows = await db()`select record from manual_checkout where record->>'buyer'=${buyer} order by updated_at desc limit 50`;
        manual = rows.map((row) => row.record as CheckoutRecord);
      } catch (err) {
        if ((err as { code?: string }).code !== '42P01') throw err;
      }
      const ids = ((await kvGet(BUYER_KEY(buyer))) as string[] | undefined) ?? [];
      const rest = (await Promise.all(ids.map(async (id) => (await kvGet(KEY(id))) as CheckoutRecord | undefined)))
        .filter((rec): rec is CheckoutRecord => Boolean(rec));
      const seen = new Set(manual.map((rec) => rec.orderId));
      return [...manual, ...rest.filter((rec) => !seen.has(rec.orderId))];
    },
    async set(rec) {
      if (rec.checkoutKind === 'manual_fee_v1') {
        await db()`insert into manual_checkout(order_id,record) values(${rec.orderId},${db().json(rec as never)})
          on conflict(order_id) do update set record = case
            when manual_checkout.event_seq > ${rec.manual?.sequence ?? 0}
            then manual_checkout.record || ${db().json(rec as never)} || jsonb_build_object(
              'manual', manual_checkout.record->'manual', 'jobId', manual_checkout.record->'jobId',
              'phase', manual_checkout.record->'phase', 'storeOrderId', manual_checkout.record->'storeOrderId')
            else manual_checkout.record || ${db().json(rec as never)} end, updated_at=now()`;
        return;
      }
      await kvSet(KEY(rec.orderId), rec, TTL_SECONDS);
      const ids = ((await kvGet(BUYER_KEY(rec.buyer))) as string[] | undefined) ?? [];
      if (!ids.includes(rec.orderId)) {
        await kvSet(BUYER_KEY(rec.buyer), [rec.orderId, ...ids].slice(0, 50), TTL_SECONDS);
      }
    },
  };
}

const g = globalThis as { __chgCheckouts?: Map<string, CheckoutRecord> };

function memoryStore(): Store {
  const map = (g.__chgCheckouts ??= new Map());
  return {
    async get(orderId) {
      return map.get(orderId);
    },
    async listByBuyer(buyer) {
      return [...map.values()].filter((rec) => rec.buyer === buyer);
    },
    async set(rec) {
      map.set(rec.orderId, rec);
    },
  };
}

let store: Store | undefined;

export function checkoutStore(): Store {
  if (!store) store = hasDatabase() ? postgresStore() : memoryStore();
  return store;
}
