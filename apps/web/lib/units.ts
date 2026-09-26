/**
 * Stellar amounts as integers, with nothing else in the file.
 *
 * This lived in deposit-watch.ts, next to the matcher that is its only reason
 * for existing, and it moved for one reason: **the browser needs it now.**
 * CheckoutModal compares the importe against the shopper's balance before
 * offering to pay it, and deposit-watch.ts imports `horizon` from stellar.ts,
 * which imports @stellar/stellar-sdk — several hundred kilobytes of XDR codec
 * that has no business in a page bundle.
 *
 * The alternative was to write the parse a second time inside the component.
 * Money arithmetic duplicated is money arithmetic that drifts, and the two
 * copies would have been the server deciding a deposit had landed and the
 * browser deciding it could be sent — the two ends of the same comparison.
 *
 * So: no imports, and none may be added. That emptiness is the feature. It is
 * what lets both a client component and a Horizon matcher share one function
 * without either dragging the other's dependencies along.
 */

/**
 * A 7-decimal decimal string as an integer, or null if it is not one.
 *
 * Hand-rolled rather than `Number(x) * 1e7`: that multiplication is exactly
 * the floating-point error this exists to avoid, and BigInt cannot parse a
 * decimal point. Anything Horizon emits is `\d+(\.\d{1,7})?`; anything else is
 * not a Stellar amount and is refused rather than coerced.
 */
export function stroops(amount: string): bigint | null {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0'));
}
