/**
 * Which Soroban RPC a request talks to.
 *
 * The URLs recorded in `deployments.ts` are the defaults. A Worker runtime
 * variable replaces one for this request, so pointing testnet at another
 * public RPC does not take a build. The names are not `NEXT_PUBLIC_*`: those
 * are inlined when the bundle is built, and a value set afterwards would
 * never be read.
 */

import { DEPLOYMENTS, type NetworkId } from './deployments.ts';

export const RPC_URL_VARS = {
  testnet: 'STELLAR_RPC_URL',
  mainnet: 'STELLAR_RPC_URL_MAINNET',
} as const;

export const RPC_URL_VAR_NAMES = [RPC_URL_VARS.testnet, RPC_URL_VARS.mainnet] as const;

/** https only, no credentials, no query. Anything else is ignored. */
export function readRpcUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/$/, '');
  return `${url.origin}${path}`;
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

/** Recorded URL, with a valid runtime variable winning for this request. */
export function rpcUrl(
  net: NetworkId,
  env: { [key: string]: string | undefined } = process.env,
): string {
  return readRpcUrl(env[RPC_URL_VARS[net]]) ?? DEPLOYMENTS[net].rpcUrl;
}
