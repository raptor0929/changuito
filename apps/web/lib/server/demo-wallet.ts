/**
 * The one key this deployment holds, and the only money it can move.
 *
 * `app/api/deposit/route.ts` used to open with "there is no secret key in this
 * deployment and no outbound path". That was true and it was load-bearing: a
 * reader could stop worrying about a whole class of failure. Preview mode
 * ended it. A visitor with no session has no wallet to pay from, so if the
 * demo is going to settle a real payment on a real ledger, something has to
 * sign, and that something is here.
 *
 * So the claim is narrowed rather than dropped, and the narrowing is enforced
 * by four separate things rather than by intent:
 *
 *   1. **The asset is worthless.** `scripts/setup-demo-asset.mjs` issued the
 *      testnet USDC this pays with, from an issuer whose master weight is now
 *      zero. A billion of it exists and no more ever will. It is play money on
 *      a play ledger.
 *   2. **The destination is fixed.** Nothing here takes a destination. It pays
 *      `depositAddress('testnet')` and there is no parameter to point it
 *      somewhere else.
 *   3. **The network is fixed.** `demoWallet` is pinned in deployments.json
 *      per network and is `''` on mainnet, so the public-key check below
 *      cannot pass there. A mainnet secret pasted into `DEMO_WALLET_SECRET`
 *      fails at the first call instead of signing on a chain nobody meant to
 *      touch — the same discipline, and the same reasoning, as
 *      lib/server/resolver.ts, which this is modelled on.
 *   4. **The secret is read at call time, never at import.** A build without
 *      the variable still succeeds, and only the route that actually signs
 *      fails.
 *
 * The mainnet rail is unchanged: no key, no outbound path, and a refund is
 * still a human doing it by hand.
 *
 * The value is never echoed, not even a prefix of it.
 */
import { Keypair } from '@stellar/stellar-sdk';

import { DEPLOYMENTS, type NetworkId } from '../deployments.ts';

/** Named once, so the error messages and the docs cannot drift apart. */
export const DEMO_WALLET_SECRET_VAR = 'DEMO_WALLET_SECRET';

/** The pinned public key, or `''` on a network that has no demo wallet. */
export function demoWalletAddress(net: NetworkId): string {
  return DEPLOYMENTS[net].demoWallet;
}

/**
 * Whether this network could have a demo wallet at all — asked before the
 * secret is looked for, so a route can refuse a wrong network without
 * distinguishing "not configured here" from "not set up yet".
 */
export function canDemoPay(net: NetworkId, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(demoWalletAddress(net)) && Boolean(env[DEMO_WALLET_SECRET_VAR]?.trim());
}

export function demoWalletKeypair(net: NetworkId, env: NodeJS.ProcessEnv = process.env): Keypair {
  const expected = demoWalletAddress(net);
  // Checked first and by itself: on a network with no pinned wallet there is
  // nothing a secret could be right for, and looking for one would only
  // produce a more confusing error.
  if (!expected) {
    throw new Error(`There is no demo wallet on ${net}. Only the network with one in deployments.json can pay.`);
  }

  const secret = env[DEMO_WALLET_SECRET_VAR]?.trim();
  if (!secret) {
    throw new Error(`${DEMO_WALLET_SECRET_VAR} is not set. See apps/web/.env.example.`);
  }

  let kp: Keypair;
  try {
    kp = Keypair.fromSecret(secret);
  } catch {
    throw new Error(`${DEMO_WALLET_SECRET_VAR} is not a valid Stellar secret key.`);
  }

  if (kp.publicKey() !== expected) {
    throw new Error(
      `${DEMO_WALLET_SECRET_VAR} is for ${kp.publicKey()}, but ${net}'s demo wallet is ${expected}. Use the matching key.`,
    );
  }
  return kp;
}
