/**
 * The one choke point for which networks this deployment will serve.
 *
 * Mode follows the session; network follows the Pollar key (lib/pollar.ts).
 * With the testnet key set, the served set is `{testnet}` — a request that
 * asks for mainnet is refused, not coerced to the default. Coercion would
 * silently settle, quote or archive on a chain the caller did not name.
 *
 * Served networks are computed from the same env vars the browser reads:
 * DEFAULT_NETWORK is always in the set, and LOGIN_NETWORK joins it when a
 * key exists. No second "network name" variable.
 */
import { asNetwork, DEFAULT_NETWORK, type NetworkId } from './deployments.ts';
import { LOGIN_NETWORK } from './pollar.ts';

/** Networks this process will answer for. Always includes the default. */
export function servedNetworks(
  login: NetworkId | null = LOGIN_NETWORK,
  fallback: NetworkId = DEFAULT_NETWORK,
): readonly NetworkId[] {
  if (login && login !== fallback) return [fallback, login];
  return [fallback];
}

export type NetworkRequest =
  | { ok: true; network: NetworkId }
  | { ok: false; error: 'network_not_served' };

/**
 * Narrow an untrusted network parameter to one this deployment serves.
 *
 * Absent / empty → the default (always served). Present but unknown, or known
 * but not served → `{ ok: false, error: 'network_not_served' }`. Never
 * coerces a wrong value to the default.
 */
export function requestNetwork(
  param: unknown,
  login: NetworkId | null = LOGIN_NETWORK,
  fallback: NetworkId = DEFAULT_NETWORK,
): NetworkRequest {
  const served = servedNetworks(login, fallback);
  if (param === undefined || param === null || param === '') {
    return { ok: true, network: fallback };
  }
  const net = asNetwork(param);
  if (!net || !served.includes(net)) {
    return { ok: false, error: 'network_not_served' };
  }
  return { ok: true, network: net };
}

/** JSON body + status for a refused network. Shared by every route. */
export function networkNotServed(): Response {
  return Response.json(
    { error: 'network_not_served' },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}
