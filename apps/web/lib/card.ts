/**
 * The single-use card the shopper types into the súper's own payment form.
 *
 * The shopper can always pay with their own card — the frame is the store's
 * real checkout and nothing here is required. This is the other option: a
 * card funded with exactly this basket, usable once, terminated after.
 *
 * ## What stops anyone minting one
 *
 * Nothing the browser says. `POST /api/card` takes a código, re-reads the
 * ledger for a payment carrying it, and derives the amount **from the payment
 * that actually landed** — never from the request body. A figure sent by a
 * client is a figure a client chose.
 *
 * Then it is claimed exactly once. A deposit that already bought a card
 * cannot buy a second, and the claim is a Redis SETNX rather than a read
 * followed by a write, because two tabs pressing the button together is the
 * ordinary case and not the adversarial one.
 *
 * ## What is never written down
 *
 * The PAN and CVV go from Vyrion to the shopper's screen and stop there. Not
 * a log line, not localStorage, not a Playwright trace — `e2e/app-auth.spec.ts`
 * already turns traces off for this repo because it is public, and this is the
 * reason that matters most. `VyrionClient.cardDetails` registers both with the
 * redactor on arrival, so even a careless `log()` elsewhere cannot print them.
 */
import { Redis } from '@upstash/redis';
import { CARD_MAX_CENTS, CARD_MIN_CENTS, VyrionClient } from '@changuito/mcp/pay';

import { depositAsset } from './deposit.ts';
import { findDeposit } from './deposit-watch.ts';
import type { NetworkId } from './deployments.ts';

/** Vyrion's own docs put this at 30s; leave room and fail rather than hang. */
const TIMEOUT_MS = 45_000;
const RETRIES = 2;
/** A claim outlives the order by a day, so a refresh cannot re-mint. */
const CLAIM_TTL_SECONDS = 86_400;

/**
 * `packages/mcp/src/util/http.ts` has a timeout and a backoff, and the plan
 * was to route these calls through it. Reading it decided otherwise: it is
 * VTEX's client — it throws `RetailerError`, sends `Accept-Language: es-AR`,
 * and refuses any body that does not start with a brace because Coto answers
 * 200 with an Angular shell. None of that is true of a card API. So the
 * wrapper is here, it is the two behaviours that were actually missing, and
 * `VyrionClient` takes it as its `fetchImpl` without knowing.
 */
export function timeoutFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    let last: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await inner(input, { ...init, signal: ctrl.signal });
        // 429 and 5xx are worth another go; a 4xx is an answer.
        if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
          await sleep(2 ** attempt * 500);
          continue;
        }
        return res;
      } catch (e) {
        last = e;
        if (attempt >= RETRIES) break;
        await sleep(2 ** attempt * 500);
      } finally {
        clearTimeout(timer);
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** False means the button is not offered at all, rather than offered and broken. */
export function canIssueCard(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.VYRION_API_KEY ?? '').trim());
}

export function cardClient(env: NodeJS.ProcessEnv = process.env): VyrionClient {
  return new VyrionClient({
    apiKey: (env.VYRION_API_KEY ?? '').trim(),
    // The guard in vyrion.ts refuses an sk_live_ key without this. It stays
    // an explicit opt-in: four characters in an env var are the only thing
    // between the sandbox and somebody's money.
    allowLive: env.ALLOW_LIVE === '1',
    fetchImpl: timeoutFetch(),
  });
}

/**
 * What the deposit is worth, read from the ledger rather than from the caller.
 *
 * On mainnet the asset is USDC and one is one dollar. On testnet it is XLM and
 * the figure is the same number of play tokens the quote asked for — see the
 * long note in app/api/deposit/route.ts about why that is deliberately not an
 * XLM price. Either way the arithmetic here is "what arrived", not "what was
 * asked for": a shopper who sent more gets a card for more, and one who sent
 * less does not get a card for the difference.
 */
export function centsFromAmount(amount: string): number | null {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  // Cents by string, not by float: 0.1 + 0.2 is the reason deposit-watch.ts
  // counts stroops, and the same reason applies to a figure that buys a card.
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export interface FundedDeposit {
  txHash: string;
  cents: number;
}

/**
 * The deposit that pays for this card, or a reason there is not one. Never
 * throws for "no deposit" — the caller has to tell those two apart to answer
 * honestly, and Horizon being unreachable is not a shopper who has not paid.
 */
export async function fundingFor(
  net: NetworkId,
  memo: string,
  address: string,
): Promise<FundedDeposit | null> {
  const hit = await findDeposit(net, {
    to: address,
    asset: depositAsset(net),
    memo,
    // Any amount: the quote is not known here, and the card is funded with
    // whatever landed. The bounds below are what keeps that sane.
    minAmount: '0',
  });
  if (!hit) return null;
  const cents = centsFromAmount(hit.amount);
  if (cents === null) return null;
  return { txHash: hit.txHash, cents };
}

export type FundingRefusal = 'too-small' | 'too-large';

export function refuseFunding(cents: number): FundingRefusal | null {
  if (cents < CARD_MIN_CENTS) return 'too-small';
  if (cents > CARD_MAX_CENTS) return 'too-large';
  return null;
}

function credentials(): { url: string; token: string } | undefined {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : undefined;
}

/** Bounded, and per-instance. The same degrade turn-store.ts makes, for the
 *  same reason: a fresh clone with no Redis still runs, and a single instance
 *  still refuses a second card for the same deposit. */
const localClaims = new Map<string, string>();

const claimKey = (net: NetworkId, memo: string) => `chg:card:${net}:${memo}`;

/**
 * Take the deposit, or find out who already did.
 *
 * Returns the card id on success and the existing one on a second attempt, so
 * a shopper who refreshed sees the card they already have rather than an error
 * about a card they do not remember asking for.
 */
export async function claimDeposit(
  net: NetworkId,
  memo: string,
  cardId: string,
): Promise<{ claimed: boolean; existing?: string }> {
  const key = claimKey(net, memo);
  const creds = credentials();
  if (!creds) {
    const held = localClaims.get(key);
    if (held) return { claimed: false, existing: held };
    localClaims.set(key, cardId);
    return { claimed: true };
  }
  const redis = new Redis(creds);
  // NX is the whole point: a get-then-set loses the race that matters.
  const ok = await redis.set(key, cardId, { nx: true, ex: CLAIM_TTL_SECONDS });
  if (ok) return { claimed: true };
  const existing = await redis.get<string>(key);
  return { claimed: false, existing: existing ?? undefined };
}

/** Who holds this deposit's card, if anyone. Read-only; never claims. */
export async function heldCard(net: NetworkId, memo: string): Promise<string | undefined> {
  const key = claimKey(net, memo);
  const creds = credentials();
  if (!creds) return localClaims.get(key);
  const redis = new Redis(creds);
  return (await redis.get<string>(key)) ?? undefined;
}

/* ---- who opened the deposit -------------------------------------------- */

const localOwners = new Map<string, string>();

const ownerKey = (net: NetworkId, memo: string) => `chg:depositor:${net}:${memo}`;

/**
 * The wallet that was allowed through `authorizeRealMode` to open this memo.
 *
 * Written when the deposit intent is minted, read when a card is asked for.
 * **It is not authentication of the caller** — `POST /api/card` still takes
 * nothing but the memo, because a proof lives five minutes and a deposit can
 * take longer than that to confirm, and refusing a shopper who has already
 * sent real money is the worst moment available to fail.
 *
 * What it is, precisely: evidence that this memo was issued to somebody the
 * gate let in. It narrows "anyone who knows a memo can mint its card" to
 * "anyone who knows a memo that an allowed wallet opened", and no further. The
 * memo's own unguessability is what carries the rest, which is why
 * `mintMemo` draws from the CSPRNG.
 *
 * Separate key and separate map from the claim: one records who may mint, the
 * other what was minted, and they expire for different reasons. Same 24h, so
 * a memo cannot outlive its own record and turn into an unowned one.
 */
export async function rememberDepositor(net: NetworkId, memo: string, address: string): Promise<void> {
  const key = ownerKey(net, memo);
  const creds = credentials();
  if (!creds) {
    localOwners.set(key, address);
    return;
  }
  const redis = new Redis(creds);
  await redis.set(key, address, { ex: CLAIM_TTL_SECONDS });
}

/** The wallet that opened this deposit, or undefined if nothing remembers. */
export async function depositorOf(net: NetworkId, memo: string): Promise<string | undefined> {
  const key = ownerKey(net, memo);
  const creds = credentials();
  if (!creds) return localOwners.get(key);
  const redis = new Redis(creds);
  return (await redis.get<string>(key)) ?? undefined;
}
