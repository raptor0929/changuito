/**
 * The one choke point for which networks this deployment will serve.
 *
 * Mode follows the session; network follows the Pollar key (lib/pollar.ts).
 * **Only a testnet login key** shrinks the served set to `{testnet}` — that is
 * the D1 deployment on app/ste.changuito.me. With no key, or with a mainnet
 * key, both networks stay available and the existing mainnet gates
 * (allowlist, proof, isConfigured) decide. Derived from the resource, not from
 * a second variable that names the network (CLAUDE.md §5).
 *
 * The login default re-reads the key from the environment on every call
 * rather than the module-scope `LOGIN_NETWORK` const: that const is baked at
 * first import (fine for the client bundle), and a suite that sets the key
 * in one file after another file already imported pollar would otherwise
 * keep seeing `null`.
 */
import { asNetwork, DEFAULT_NETWORK, NETWORK_IDS, type NetworkId } from './deployments.ts';
import { loginNetwork } from './pollar.ts';

function loginFromEnv(): NetworkId | null {
  return loginNetwork({
    testnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
    mainnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
  });
}

/**
 * Networks this process will answer for.
 *
 * A testnet key → testnet only. Anything else (no key, or a mainnet key) →
 * every network id, unchanged from before this choke point existed.
 */
export function servedNetworks(
  login: NetworkId | null = loginFromEnv(),
  fallback: NetworkId = DEFAULT_NETWORK,
): readonly NetworkId[] {
  if (login === fallback) return [fallback];
  return NETWORK_IDS;
}

export type UnknownNetwork = 'refuse' | 'default';

export type NetworkRequest =
  | { ok: true; network: NetworkId }
  | { ok: false; error: 'network_not_served' };

/**
 * Narrow an untrusted network parameter to one this deployment serves.
 *
 * Absent / empty → the default. A *recognized but not served* value is always
 * refused (`network_not_served`) — never coerced to the default, and never to
 * mainnet. An unrecognized value follows `unknown`: `'default'` coerces to the
 * fallback (routes whose contract is to never fail); `'refuse'` returns the
 * same 400 (faucet / settle / deposit-demo, which already named unknowns).
 */
export function requestNetwork(
  param: unknown,
  login: NetworkId | null = loginFromEnv(),
  fallback: NetworkId = DEFAULT_NETWORK,
  unknown: UnknownNetwork = 'refuse',
): NetworkRequest {
  const served = servedNetworks(login, fallback);
  if (param === undefined || param === null || param === '') {
    return { ok: true, network: fallback };
  }
  const net = asNetwork(param);
  if (!net) {
    return unknown === 'default'
      ? { ok: true, network: fallback }
      : { ok: false, error: 'network_not_served' };
  }
  if (!served.includes(net)) {
    return { ok: false, error: 'network_not_served' };
  }
  return { ok: true, network: net };
}

/** JSON body + status for a refused network. Shared by every non-card route. */
export function networkNotServed(): Response {
  return Response.json(
    { error: 'network_not_served' },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}

/** Same refusal with the card routes' promised cache policy. */
export function networkNotServedPrivate(): Response {
  return Response.json(
    { error: 'network_not_served' },
    { status: 400, headers: { 'cache-control': 'private, no-store' } },
  );
}
