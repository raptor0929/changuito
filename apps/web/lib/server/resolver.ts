/**
 * The backend's one signing key.
 *
 * `changuito-resolver` wears two hats: it is the demo token's admin (so the
 * faucet can mint) and the escrow's resolver (so it can settle and refund).
 * One hot key rather than two, because a demo with two hot keys is two keys to
 * leak.
 *
 * Everything here is server-only. The module reads a secret out of the
 * environment at call time — never at import time, so a build without the
 * variable set still succeeds and only the routes that actually sign fail.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { Client as Escrow, networks as escrowNetworks } from '@changuito/escrow-bindings';
import { Client as Usdc, networks as usdcNetworks } from '@changuito/usdc-bindings';

import { DEPLOYMENTS } from '../deployments.ts';

export function resolverKeypair(): Keypair {
  const secret = process.env.STELLAR_RESOLVER_SECRET;
  if (!secret) {
    throw new Error(
      'STELLAR_RESOLVER_SECRET is not set. Run `stellar keys show changuito-resolver` and put it in .env.local — see apps/web/.env.example.',
    );
  }
  let kp: Keypair;
  try {
    kp = Keypair.fromSecret(secret.trim());
  } catch {
    // Never echo the value, not even a prefix of it.
    throw new Error('STELLAR_RESOLVER_SECRET is not a valid Stellar secret key.');
  }
  if (kp.publicKey() !== DEPLOYMENTS.resolver) {
    throw new Error(
      `STELLAR_RESOLVER_SECRET is for ${kp.publicKey()}, but the deployed contracts expect ${DEPLOYMENTS.resolver}. Re-deploy, or use the matching key.`,
    );
  }
  return kp;
}

function signing() {
  const kp = resolverKeypair();
  return {
    publicKey: kp.publicKey(),
    ...basicNodeSigner(kp, DEPLOYMENTS.networkPassphrase),
  };
}

/** The token client, authorised to mint. */
export function usdcAsAdmin(): Usdc {
  return new Usdc({ ...usdcNetworks.testnet, rpcUrl: DEPLOYMENTS.rpcUrl, ...signing() });
}

/** The escrow client, authorised to settle and to refund on a buyer's behalf. */
export function escrowAsResolver(): Escrow {
  return new Escrow({ ...escrowNetworks.testnet, rpcUrl: DEPLOYMENTS.rpcUrl, ...signing() });
}
