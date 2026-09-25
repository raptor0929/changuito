/**
 * The faucet's side of the wire, shared by the widget and the route.
 *
 * The proof itself is a wallet proof with intent `faucet`; see
 * lib/wallet-proof.ts. No imports that the browser would not already load.
 */

export type { WalletProof as FaucetProof } from './wallet-proof.ts';

/**
 * GET /api/faucet?address=… — whether to show the button at all.
 *
 * `open` exists only outside production with no allowlist, so a fresh clone
 * can still fund a wallet. `allowlist` needs a signed proof on POST, and so
 * does `public`: that one is the allowlist waived by FAUCET_OPEN_TO_ALL, not
 * the ceremony waived, so the widget has to read it the same way.
 */
export interface FaucetAccess {
  mode: 'open' | 'public' | 'allowlist' | 'disabled';
  allowed: boolean;
}
