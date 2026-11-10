/**
 * POST /api/faucet the way the gate reads it.
 *
 * The handler refuses anything that is not JSON (`expected a JSON body`)
 * before it looks at the wallet. An empty POST is that refusal. The address
 * and the network go in the body, and the proof is a SEP-53 signature for
 * the faucet intent — the same one `authorizeFaucet` checks in production.
 *
 * Returns null when the wallet will not sign, so the caller can say so in
 * the shopper's language. Nothing here decides who may mint.
 */
import type { NetworkId } from './deployments.ts';
import { fetchAs, type Who } from './fetch-as.ts';
import { signWalletProof } from './wallet-proof.ts';

export async function postFaucet(who: Who, network: NetworkId): Promise<Response | null> {
  if (!who.address) return null;
  const proof = await signWalletProof(who.sign, 'faucet', who.address);
  if (!proof) return null;
  return fetchAs(who, '/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ address: who.address, network, proof }),
  });
}
