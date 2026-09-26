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

/**
 * Token units (7 decimals), not a display string. Zero for an unknown holder.
 *
 * ## This reads the *token*, and mainnet's USDC is not one
 *
 * Only a network whose USDC is a Soroban token can answer this. Mainnet's is a
 * classic Circle asset: `contracts.usdc.id` is `""` there, and so is
 * `accounts.resolver`, so the client above is built with an empty contract id
 * and an empty source account and the SDK rejects both ("Invalid contract ID").
 * Every mainnet call landed in the caller's catch, which is how a signed-in
 * shopper came to see `could not read balances` beside their balance.
 *
 * The guard is here rather than at the call site because the failure was
 * unreadable, not because it was a surprise. A caller that has a classic
 * issuer should not be here at all — `classicBalance` in lib/stellar.ts reads
 * that number off the Horizon account it already fetched.
 */
export async function usdcBalance(address: string, net: NetworkId = DEFAULT_NETWORK): Promise<bigint> {
  const d = deployment(net);
  if (!d.usdcId) throw new Error(`no hay un token USDC desplegado en ${net}`);
  const tx = await usdcClient(undefined, net).balance({ id: address });
  return tx.result;
}
