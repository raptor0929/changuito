import type { RealModeMode } from './network-access.ts';

/**
 * The one question about modo real that both sides of the wire need to agree
 * on, in a file the browser can have.
 *
 * `lib/network-access.ts` and `lib/deposit-gate.ts` import @stellar/stellar-sdk,
 * which has no business in a page bundle, so this is the same split
 * `wallet-proof.ts` makes against `wallet-proof-verify.ts`: the shared, pure
 * half here and the half that needs a keypair over there. The `import type`
 * above is erased at build and costs nothing.
 */

/**
 * Does this mode want the wallet to sign before the server will listen?
 *
 * `'public'` is in the list on purpose. `REAL_MODE_OPEN_TO_ALL` waives the
 * allowlist and not the signature — see the note at the top of
 * `lib/deposit-gate.ts` — so "anybody may pay" still means "as somebody".
 *
 * `'open'` is local development with no list and no production; `'disabled'`
 * is a refusal before this question is reached. Neither signs.
 *
 * Shared so the dialog cannot ask for a signature the server will ignore, or
 * skip one it requires and show the shopper a refusal they cannot act on.
 */
export function realModeNeedsProof(mode: RealModeMode): boolean {
  return mode === 'allowlist' || mode === 'public';
}
