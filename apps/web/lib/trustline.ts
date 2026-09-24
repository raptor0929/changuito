import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';
import { hasTrustline, type AccountBalance } from './stellar.ts';

/**
 * Whether this account can be handed the network's USDC at all.
 *
 * The asymmetry that makes this module necessary: contracts/mock_usdc is a
 * pure SEP-41 token with no issuer, so on testnet it reaches anybody who asks.
 * Real USDC is a classic asset behind a SAC, and a classic asset cannot reach
 * an account that has not opted into it — the transfer fails, at payment time,
 * with an XDR code. So modo real needs a step modo prueba has never had, and
 * the whole difference falls out of one field: `usdcIssuer`, which is null on
 * exactly the network that needs no trustline.
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
