import type { Cart } from '@changuito/mcp/types';

import type { NetworkId } from './deployments.ts';

/**
 * Turning an approved basket into the five arguments `escrow.open` takes.
 *
 * All of it is pure and runs identically in the browser and in a test: the
 * hash the user's wallet signs has to be reproducible by anyone holding the
 * same cart, or `basket_hash` proves nothing.
 */

/** The contract's own bounds — `contracts/escrow/src/lib.rs`. */
export const MIN_TIMEOUT_SECS = 300;
export const MAX_TIMEOUT_SECS = 30 * 24 * 60 * 60;

/**
 * An hour to get the basket through the store's checkout. Long enough that a
 * slow pickup does not strand the money, short enough that a user who walks
 * away can self-refund the same afternoon rather than next month.
 */
export const DEFAULT_TIMEOUT_SECS = 3600;

/* ------------------------------------------------------------------ bytes */

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex.length} chars`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Pollar's `bytes` ScVal arg is base64, not hex. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  // Not `String.fromCharCode(...bytes)`: fine for 32 bytes, a stack overflow
  // for anything large, and this function should not care which it was given.
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/* ------------------------------------------------------------- the basket */

/**
 * The exact text that gets hashed into `basket_hash`.
 *
 * Line-oriented and versioned rather than `JSON.stringify`, because a hash is
 * a promise about bytes: object key order is an implementation detail of
 * whoever built the object, and a future refactor that reorders two fields
 * would silently produce a different commitment for the same basket.
 *
 * It commits to what the user was shown — items, quantities, per-line and
 * total pesos, and which lines the store said were unavailable. The USDC
 * amount is deliberately absent: the contract stores that as its own field,
 * so hashing it too would just be a second copy that can disagree.
 */
export function canonicalBasket(cart: Cart): string {
  const lines = [...cart.lines]
    .sort((a, b) => a.index - b.index)
    .map((l) =>
      ['line', l.index, l.skuId, l.quantity, l.lineTotal.centavos, l.available ? 'y' : 'n'].join('|'),
    );
  return [
    'changuito/basket/v1',
    `retailer|${cart.retailer}`,
    `cart|${cart.cartId}`,
    ...lines,
    `total|${cart.total.centavos}`,
    '',
  ].join('\n');
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** 32 bytes, which is exactly `BytesN<32>`. */
export function basketHash(cart: Cart): Promise<Uint8Array> {
  return sha256(canonicalBasket(cart));
}

/**
 * Random, not derived from the basket.
 *
 * `open` rejects an id it has already seen, which is what stops a double
 * submit — but it also means a *deliberate* second attempt at the same basket
 * (the first one failed in the wallet, the user tries again) must be a new
 * order, or it would be rejected for the wrong reason.
 */
export function newOrderId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/* ------------------------------------------------------------- the args */

/** The subset of Pollar's ScVal argument union that `escrow.open` needs. */
export type ScValArg =
  | { type: 'address'; value: string }
  | { type: 'bytes'; value: string }
  | { type: 'i128'; value: string }
  | { type: 'u64'; value: string };

export interface OpenArgs {
  buyer: string;
  orderId: Uint8Array;
  /** Token units, 7 decimals. Not cents. */
  amountUnits: bigint;
  basketHash: Uint8Array;
  timeoutSecs?: number;
}

/**
 * Positional, in the order the contract declares them:
 * `open(buyer, order_id, amount, basket_hash, timeout_secs)`.
 *
 * `order.test.ts` reads that signature out of lib.rs and checks it against
 * this list, because the two swapped `BytesN<32>` arguments are the kind of
 * mistake that type-checks, deploys, and then settles the wrong basket.
 */
export function openArgs({
  buyer,
  orderId,
  amountUnits,
  basketHash: basket,
  timeoutSecs = DEFAULT_TIMEOUT_SECS,
}: OpenArgs): ScValArg[] {
  if (orderId.length !== 32) throw new Error(`order_id must be 32 bytes, got ${orderId.length}`);
  if (basket.length !== 32) throw new Error(`basket_hash must be 32 bytes, got ${basket.length}`);
  if (amountUnits <= 0n) throw new Error(`amount must be positive, got ${amountUnits}`);
  if (timeoutSecs < MIN_TIMEOUT_SECS || timeoutSecs > MAX_TIMEOUT_SECS) {
    throw new Error(`timeout_secs must be ${MIN_TIMEOUT_SECS}–${MAX_TIMEOUT_SECS}, got ${timeoutSecs}`);
  }
  return [
    { type: 'address', value: buyer },
    { type: 'bytes', value: toBase64(orderId) },
    { type: 'i128', value: amountUnits.toString() },
    { type: 'bytes', value: toBase64(basket) },
    { type: 'u64', value: String(timeoutSecs) },
  ];
}

/**
 * What the browser keeps after `open` succeeds. Hex rather than bytes so it
 * survives `JSON.stringify` on its way to /api/settle.
 */
export interface OpenedOrder {
  orderId: string;
  /** The wallet that signed `open`. Only it may confirm or refund. */
  buyer: string;
  basketHash: string;
  amountUnits: string;
  /** The `escrow.open` transaction. */
  hash: string;
  retailer: string;
  cartId: string;
  totalDisplay: string;
  handoffUrl?: string;
  /**
   * Which chain this order lives on, fixed at `open`.
   *
   * On the order rather than read from the mode control, because the two can
   * disagree: an order id exists in exactly one contract, and somebody who
   * flips the mode with money still held must not send its settle to the
   * other chain — where it would come back as "no such order".
   */
  network: NetworkId;
}

/* ------------------------------------------------------------ the receipt */

export interface ReceiptInput {
  /** Hex, as the contract stores it. */
  orderId: string;
  /** The order's buyer, as read from the contract. */
  buyer: string;
  /** Hex of the basket_hash the buyer locked. */
  basketHash: string;
  /** Token units escrowed. */
  amountUnits: string;
  /** ISO 8601. Chosen by the server and returned, so the hash can be re-derived. */
  settledAt: string;
}

/**
 * What `settle` writes on-chain as `receipt_hash`.
 *
 * Every field is one the server read from the contract or chose itself. v1
 * hashed the retailer, cart id and handoff link the browser sent, which let
 * anyone put any text on-chain as a "receipt". In a full product this would
 * hash the store's own order number; until the resolver can check the store,
 * it records what is actually known: this order, this buyer, this basket,
 * released on the buyer's signed word at this moment.
 */
export function canonicalReceipt(r: ReceiptInput): string {
  return [
    'changuito/receipt/v2',
    `order|${r.orderId}`,
    `buyer|${r.buyer}`,
    `basket|${r.basketHash}`,
    `amount|${r.amountUnits}`,
    'basis|buyer-confirmed',
    `settled|${r.settledAt}`,
    '',
  ].join('\n');
}

export function receiptHash(r: ReceiptInput): Promise<Uint8Array> {
  return sha256(canonicalReceipt(r));
}

/** What the browser asks /api/settle to do once the basket is resolved. */
export type SettleAction = 'settle' | 'refund';
