/**
 * The backend's signing key, one per network.
 *
 * `changuito-resolver` wears two hats: it is the demo token's admin (so the
 * faucet can mint) and the escrow's resolver (so it can settle and refund).
 * One hot key rather than two, because a demo with two hot keys is two keys to
 * leak.
 *
 * One key *per network*, though, and never the same one: the testnet secret has
 * been through a deploy script and a shell history, and mainnet money must not
 * depend on that. Which variable holds which is checked against the deployed
 * contracts below, so a secret pasted into the wrong slot fails loudly at the
 * first call rather than signing on a chain nobody meant to touch.
 *
 * Everything here is server-only. The module reads a secret out of the
 * environment at call time — never at import time, so a build without the
 * variable set still succeeds and only the routes that actually sign fail.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { Client as Escrow } from '@changuito/escrow-bindings';
import { Client as Usdc } from '@changuito/usdc-bindings';

import { DEFAULT_NETWORK, deployment, type NetworkId } from '../deployments.ts';

/** The env var holding the secret for each network. */
const SECRET_VAR: Record<NetworkId, string> = {
  testnet: 'STELLAR_RESOLVER_SECRET',
  mainnet: 'STELLAR_RESOLVER_SECRET_MAINNET',
};

export function resolverKeypair(net: NetworkId = DEFAULT_NETWORK): Keypair {
  const name = SECRET_VAR[net];
  const secret = process.env[name];
  if (!secret) {
    throw new Error(
      `${name} is not set. Run \`stellar keys show changuito-resolver-${net}\` and put it in .env.local — see apps/web/.env.example.`,
    );
  }
  let kp: Keypair;
  try {
    kp = Keypair.fromSecret(secret.trim());
  } catch {
    // Never echo the value, not even a prefix of it.
    throw new Error(`${name} is not a valid Stellar secret key.`);
  }
  const expected = deployment(net).resolver;
  if (kp.publicKey() !== expected) {
    throw new Error(
      `${name} is for ${kp.publicKey()}, but the contracts deployed on ${net} expect ${expected}. Re-deploy, or use the matching key.`,
    );
  }
  return kp;
}

function signing(net: NetworkId) {
  const kp = resolverKeypair(net);
  return {
    publicKey: kp.publicKey(),
    ...basicNodeSigner(kp, deployment(net).networkPassphrase),
  };
}

/** The token client, authorised to mint. Testnet only in practice. */
export function usdcAsAdmin(net: NetworkId = DEFAULT_NETWORK): Usdc {
  const d = deployment(net);
  return new Usdc({
    contractId: d.usdcId,
    networkPassphrase: d.networkPassphrase,
    rpcUrl: d.rpcUrl,
    ...signing(net),
  });
}

/** The escrow client, authorised to settle and to refund on a buyer's behalf. */
export function escrowAsResolver(net: NetworkId = DEFAULT_NETWORK): Escrow {
  const d = deployment(net);
  return new Escrow({
    contractId: d.escrowId,
    networkPassphrase: d.networkPassphrase,
    rpcUrl: d.rpcUrl,
    ...signing(net),
  });
}
