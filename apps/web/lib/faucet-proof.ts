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
 * `public` is `config.faucet_open_to_all`: every wallet that is not banned.
 * `allowlist` is one `wallet.faucet_allowed` row. Both still require a signed
 * proof on POST. There is no mode that skips the signature.
 */
export interface FaucetAccess {
  mode: 'public' | 'allowlist' | 'disabled';
  allowed: boolean;
}
