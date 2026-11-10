/**
 * The evidence rule for closing an escrow order.
 *
 * A confirmed Día cart whose basket hash matches the one locked at `open`
 * may be released. A failed or expired order is refunded. A release that
 * presents any other basket is refused as `BasketMismatch` — the same error
 * the contract raises — before anyone signs.
 *
 * Pure on purpose: live Día carts and Channels submission land once the
 * release/refund path is wired; this file is the decision those paths share.
 */

export type StoreEvidence = 'confirmed' | 'failed' | 'expired';

export type EvidenceDecision =
  | { action: 'release' }
  | { action: 'refund'; reason: 'failed' | 'expired' }
  | { action: 'reject'; error: 'BasketMismatch' };

export function decideOrderEvidence(input: {
  /** Hex `basket_hash` the buyer locked when the escrow opened. */
  lockedBasketHash: string;
  /** Hex hash of the basket being presented for settle. */
  presentedBasketHash: string;
  /** What the store (or the deadline) says about the order. */
  store: StoreEvidence;
}): EvidenceDecision {
  if (input.store === 'failed' || input.store === 'expired') {
    return { action: 'refund', reason: input.store };
  }

  const locked = input.lockedBasketHash.toLowerCase();
  const presented = input.presentedBasketHash.toLowerCase();
  if (presented !== locked) {
    return { action: 'reject', error: 'BasketMismatch' };
  }
  return { action: 'release' };
}
