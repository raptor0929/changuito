/**
 * Reading the demo USDC balance of any address.
 *
 * Server-side only, and deliberately so: the generated bindings pull in
 * @stellar/stellar-sdk, which is ~400 kB of XDR machinery the browser has no
 * reason to download just to render a number. The browser asks /api/balance.
 */
import { Client as Usdc, networks } from '@changuito/usdc-bindings';

import { DEPLOYMENTS } from './deployments.ts';

/**
 * A simulation still needs a source account to charge the imaginary fee to, and
 * it must exist on the ledger. The resolver is funded and signs nothing here.
 */
const SIMULATION_SOURCE = DEPLOYMENTS.resolver;

export function usdcClient(publicKey: string = SIMULATION_SOURCE): Usdc {
  return new Usdc({
    ...networks.testnet,
    rpcUrl: DEPLOYMENTS.rpcUrl,
    publicKey,
  });
}

/** Token units (7 decimals), not a display string. Zero for an unknown holder. */
export async function usdcBalance(address: string): Promise<bigint> {
  const tx = await usdcClient().balance({ id: address });
  return tx.result;
}
