import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';
import { hasTrustline, type AccountBalance } from './stellar.ts';

/**
 * Whether this account can be handed the network's USDC at all.
 *
 * A classic asset cannot reach an account that has not opted into it: the
 * transfer fails at payment time with an XDR code, after the sender pressed
 * send. So anything that is about to receive USDC needs a trustline first.
 *
 * This module was written for an asymmetry that no longer exists. Testnet's
 * USDC used to be contracts/mock_usdc, a pure SEP-41 token with no issuer,
 * which reaches anybody who asks — so `usdcIssuer` was null on exactly the
 * network that needed no trustline, and modo real needed a step modo prueba
 * had never taken. `scripts/setup-demo-asset.mjs` ended that: testnet now has
 * a classic USDC of its own and both networks take the same step.
 *
 * The null branch is still live and still correct. It is what an undeployed
 * network reads as, and what a Soroban contract holding a SAC asset reads as —
 * a contract's balance lives in contract storage and needs no trustline — so
 * `trustlineFor(…, null)` is tested directly rather than through a config
 * that happens to produce it.
 */

export interface ClassicAsset {
  code: string;
  issuer: string;
}

/**
 * The classic asset this network's USDC wraps, or null when it wraps none.
 *
 * The annotations are load-bearing. DEPLOYMENTS is `as const`, and today every
 * `usdcIssuer` in it is `null` or `''` — so without them TypeScript proves the
 * truthy branch unreachable and narrows the config object itself to `never`.
 * That proof is correct and temporary: it expires the moment mainnet is
 * deployed, and the code has to compile on both sides of that.
 */
export function usdcAsset(net: NetworkId = DEFAULT_NETWORK): ClassicAsset | null {
  const code: string = DEPLOYMENTS[net].usdcCode;
  const issuer: string | null = DEPLOYMENTS[net].usdcIssuer;
  return issuer ? { code, issuer } : null;
}

/**
 * - `not-needed` — this network's token has no issuer, or the holder is a
 *   contract. A Soroban contract's balance lives in contract storage, so a
 *   smart wallet holds a SAC asset with no trustline and never sees this.
 * - `ok` — the line is open.
 * - `needed` — it is not, including when the account is not on the ledger at
 *   all, because an account that does not exist has opted into nothing.
 */
export type TrustlineState = 'not-needed' | 'ok' | 'needed';

export function trustlineState(
  balances: AccountBalance[] | null,
  net: NetworkId = DEFAULT_NETWORK,
): TrustlineState {
  return trustlineFor(balances, usdcAsset(net));
}

/**
 * The same answer for an asset named directly. Split out so it can be tested
 * against a real issuer today: DEPLOYMENTS.mainnet is empty until the deploy,
 * and a test that can only run after the thing it guards is not a tripwire.
 */
export function trustlineFor(balances: AccountBalance[] | null, asset: ClassicAsset | null): TrustlineState {
  if (!asset) return 'not-needed';
  if (balances === null) return 'needed';
  return hasTrustline(balances, asset.code, asset.issuer) ? 'ok' : 'needed';
}
