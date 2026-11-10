/**
 * Which escrow and token a request talks to.
 *
 * The ids recorded in `deployments.ts` are the last deploy. A Worker runtime
 * variable replaces one of them for this request, so pointing the shop at
 * another contract does not take a build. The names are not `NEXT_PUBLIC_*`:
 * those are inlined when the bundle is built, and a value set afterwards
 * would never be read.
 *
 * The browser does not read `process.env`. It asks `/api/contracts`, and this
 * module answers from the env of the request that is running.
 */
import { deployment, type NetworkId } from './deployments.ts';

/** Strkey contract id: `C` plus 55 characters from the Stellar alphabet. */
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

export const CONTRACT_ID_VARS = {
  testnet: { escrow: 'STELLAR_ESCROW_ID', usdc: 'STELLAR_USDC_ID' },
  mainnet: { escrow: 'STELLAR_ESCROW_ID_MAINNET', usdc: 'STELLAR_USDC_ID_MAINNET' },
} as const;

export const CONTRACT_ID_VAR_NAMES = [
  CONTRACT_ID_VARS.testnet.escrow,
  CONTRACT_ID_VARS.testnet.usdc,
  CONTRACT_ID_VARS.mainnet.escrow,
  CONTRACT_ID_VARS.mainnet.usdc,
] as const;

function readContractId(value: string | undefined): string | null {
  const id = value?.trim() ?? '';
  return CONTRACT_ID.test(id) ? id : null;
}

/**
 * Copy Worker bindings onto the env the rest of the app already reads.
 *
 * A binding that is missing or blank is left alone, so a local `process.env`
 * is not wiped by a fetch whose env object does not carry these names.
 */
export function applyContractIdBindings(
  cfEnv: unknown,
  env: { [key: string]: string | undefined } = process.env,
): void {
  if (!cfEnv || typeof cfEnv !== 'object') return;
  const record = cfEnv as Record<string, unknown>;
  for (const name of CONTRACT_ID_VAR_NAMES) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) env[name] = value.trim();
  }
}

/** Recorded ids, with a valid runtime variable winning for this request. */
export function contractIds(
  net: NetworkId,
  env: NodeJS.ProcessEnv = process.env,
): { escrowId: string; usdcId: string } {
  const recorded = deployment(net);
  const names = CONTRACT_ID_VARS[net];
  return {
    escrowId: readContractId(env[names.escrow]) ?? recorded.escrowId,
    usdcId: readContractId(env[names.usdc]) ?? recorded.usdcId,
  };
}
