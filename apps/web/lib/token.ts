/**
 * Reading the USDC balance of any address, on any network.
 *
 * Server-side only, and deliberately so: the generated bindings pull in
 * @stellar/stellar-sdk, which is ~400 kB of XDR machinery the browser has no
 * reason to download just to render a number. The browser asks /api/balance.
 *
 * Note what is *not* imported: the bindings' own `networks` export. It bakes in
 * one contract id at generation time, so reading it would tie every client to
 * testnet for good. The bindings are used as pure ABI — argument encoding and
 * error codes, which are the same on every network — and the ids come from
 * lib/deployments.ts instead.
 */
import { Client as Usdc } from '@changuito/usdc-bindings';

import { DEFAULT_NETWORK, deployment, type NetworkId } from './deployments.ts';

export function usdcClient(publicKey?: string, net: NetworkId = DEFAULT_NETWORK): Usdc {
  const d = deployment(net);
  return new Usdc({
    contractId: d.usdcId,
    networkPassphrase: d.networkPassphrase,
    rpcUrl: d.rpcUrl,
    // A simulation still needs a source account to charge the imaginary fee to,
    // and it must exist on the ledger. The resolver is funded and signs nothing
    // here.
    publicKey: publicKey ?? d.resolver,
  });
}

/** Token units (7 decimals), not a display string. Zero for an unknown holder. */
export async function usdcBalance(address: string, net: NetworkId = DEFAULT_NETWORK): Promise<bigint> {
  const tx = await usdcClient(undefined, net).balance({ id: address });
  return tx.result;
}
