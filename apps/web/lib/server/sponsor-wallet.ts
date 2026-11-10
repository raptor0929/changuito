/**
 * Changuito's classic sponsor account — pays account + trustline reserves.
 *
 * Read at call time, never at import. There is no public key pinned in
 * deployments.ts (that file is generated and must not be hand-edited); the
 * secret alone is the authority. The value is never echoed.
 */
import { Keypair } from '@stellar/stellar-sdk';

export const SPONSOR_SECRET_VAR = 'STELLAR_SPONSOR_SECRET';

export function sponsorKeypair(env: NodeJS.ProcessEnv = process.env): Keypair {
  const secret = env[SPONSOR_SECRET_VAR]?.trim();
  if (!secret) {
    throw new Error(`${SPONSOR_SECRET_VAR} is not set. See apps/web/.env.example.`);
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error(`${SPONSOR_SECRET_VAR} is not a valid Stellar secret key.`);
  }
}

export function canSponsor(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[SPONSOR_SECRET_VAR]?.trim());
}
