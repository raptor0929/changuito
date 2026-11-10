/**
 * Which Soroban RPC a request talks to.
 *
 * The URL recorded in `deployments.ts` is the default. A Worker runtime
 * variable replaces it for this request, the way `contract-ids.ts` replaces a
 * contract, so moving to another provider does not take a build. The names
 * are not `NEXT_PUBLIC_*`: only the server calls the RPC, and the browser
 * does not read `process.env`.
 *
 * A URL from the env is never logged. A provider may carry its key in the
 * path.
 */
import { DEPLOYMENTS, type NetworkId } from './deployments.ts';

export const RPC_URL_VARS = {
  testnet: 'STELLAR_RPC_URL',
  mainnet: 'STELLAR_RPC_URL_MAINNET',
} as const;

export const RPC_URL_VAR_NAMES = [RPC_URL_VARS.testnet, RPC_URL_VARS.mainnet] as const;

function readRpcUrl(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname ? text : null;
  } catch {
    return null;
  }
}

/**
 * Copy Worker bindings onto the env the rest of the app already reads.
 *
 * A binding that is missing or blank is left alone, so a local `process.env`
 * is not wiped by a fetch whose env object does not carry these names.
 */
export function applyRpcUrlBindings(
  cfEnv: unknown,
  env: { [key: string]: string | undefined } = process.env,
): void {
  if (!cfEnv || typeof cfEnv !== 'object') return;
  const record = cfEnv as Record<string, unknown>;
  for (const name of RPC_URL_VAR_NAMES) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) env[name] = value.trim();
  }
}

/** The recorded URL, with a valid https runtime variable winning for this request. */
export function rpcUrl(net: NetworkId, env: NodeJS.ProcessEnv = process.env): string {
  return readRpcUrl(env[RPC_URL_VARS[net]]) ?? DEPLOYMENTS[net].rpcUrl;
}
