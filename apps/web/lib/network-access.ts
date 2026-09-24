import { StrKey } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, isConfigured, type NetworkId } from './deployments.ts';

/**
 * Who may switch the app into modo real. Server-only.
 *
 * Modo real moves actual USDC on a public network, so the question is the same
 * one lib/faucet-auth.ts already answers for the mint key, and the answer has
 * the same shape on purpose: an explicit allowlist of wallet addresses, denied
 * by default in production.
 *
 * Why a wallet address rather than an account or a session: the same reason
 * given in faucet-auth.ts. A signature over a message naming the address is
 * something the server can check with nothing but the address. Here it matters
 * more than it does for the faucet, because the thing being gated is not play
 * money — so the allowlist is checked against an address that has *already*
 * been proven by a SEP-53 signature, never one the browser merely claims.
 *
 * Deny by default: in production an empty list means nobody, which also covers
 * Vercel previews, since those run as production too. Testnet is never gated;
 * it is the default and it cannot spend anything.
 */

export type RealModeMode = 'allowlist' | 'disabled' | 'open';

export interface NetworkAccess {
  mode: RealModeMode;
  /** Whether this wallet may ask for this network. Says nothing about uptime. */
  allowed: boolean;
  /** Whether the contracts exist yet. Only told to somebody already allowed. */
  configured: boolean;
  /** Both of the above. What the toggle actually needs. */
  usable: boolean;
}

/** Comma, space or newline separated; anything that is not a G… address is dropped. */
export function realModeAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.REAL_MODE_ALLOWLIST_ADDRESSES ?? '';
  const out = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const address = part.trim().toUpperCase();
    if (StrKey.isValidEd25519PublicKey(address)) out.add(address);
  }
  return out;
}

export function realModeMode(env: NodeJS.ProcessEnv = process.env): RealModeMode {
  if (realModeAllowlist(env).size > 0) return 'allowlist';
  return env.NODE_ENV === 'production' ? 'disabled' : 'open';
}

/**
 * May this address use this network?
 *
 * The default network is always yes — gating testnet would only stop people
 * from using the demo. Everything else goes through the allowlist *and* has to
 * actually be deployed, and those two are kept apart on purpose: whether the
 * contracts are up is a fact about us, not about the caller.
 */
export function networkAccess(
  address: string,
  net: NetworkId,
  env: NodeJS.ProcessEnv = process.env,
): NetworkAccess {
  const configured = isConfigured(net);
  const yes = (mode: RealModeMode, allowed: boolean) => ({ mode, allowed, configured, usable: allowed && configured });

  if (net === DEFAULT_NETWORK) return yes('open', true);

  const mode = realModeMode(env);
  if (mode === 'open') return yes(mode, true);
  if (mode === 'disabled') return yes(mode, false);
  return yes(mode, realModeAllowlist(env).has(address.trim().toUpperCase()));
}

export type NetworkDenial = { error: string; message: string; status: 403 };

/**
 * The refusal to send, or null to proceed. Separate from `networkAccess` so a
 * route can answer "why not" in words a shopper can read, and so the wording
 * is tested in one place rather than at each call site.
 *
 * The allowlist is checked *before* the deployment, so a stranger is told only
 * that they may not — never whether there is anything there to reach. It also
 * keeps the refusal a caller sees stable as mainnet comes up.
 */
export function denyNetwork(
  address: string,
  net: NetworkId,
  env: NodeJS.ProcessEnv = process.env,
): NetworkDenial | null {
  const access = networkAccess(address, net, env);
  if (!access.allowed) {
    return { status: 403, error: 'network_not_allowed', message: 'Esta cuenta no tiene habilitado el modo real.' };
  }
  if (!access.configured) {
    return { status: 403, error: 'network_not_deployed', message: 'El modo real todavía no está disponible.' };
  }
  return null;
}
