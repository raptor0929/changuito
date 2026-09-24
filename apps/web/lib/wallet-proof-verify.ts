import { createHash } from 'node:crypto';

import { Keypair } from '@stellar/stellar-sdk';

import {
  parseWalletProofMessage,
  WALLET_PROOF_SKEW_MS,
  WALLET_PROOF_TTL_MS,
  type WalletIntent,
  type WalletProof,
} from './wallet-proof.ts';

/**
 * Server half of lib/wallet-proof.ts. Pure apart from the clock, which the
 * caller passes in.
 */

const SEP53_PREFIX = 'Stellar Signed Message:\n';

/** SEP-53: ed25519 over SHA-256(prefix + message), signature base64. */
export function verifySep53(address: string, message: string, signatureB64: string): boolean {
  try {
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length !== 64) return false;
    const digest = createHash('sha256').update(SEP53_PREFIX + message, 'utf8').digest();
    return Keypair.fromPublicKey(address).verify(digest, signature);
  } catch {
    return false;
  }
}

export type WalletProofVerdict =
  | { ok: true }
  | { ok: false; error: 'proof_missing' | 'proof_invalid' | 'proof_expired' };

/**
 * Does `proof` show that the holder of `address` asked for `intent` (on
 * `ref`, for order intents) within the last few minutes?
 *
 * Checks the cheap things first and the signature last, and never says which
 * part of an invalid proof was wrong beyond "expired".
 */
export function verifyWalletProof(args: {
  intent: WalletIntent;
  address: string;
  proof: Partial<WalletProof> | null | undefined;
  now: number;
  ref?: string;
}): WalletProofVerdict {
  const message = typeof args.proof?.message === 'string' ? args.proof.message : '';
  const signature = typeof args.proof?.signature === 'string' ? args.proof.signature : '';
  if (!message || !signature) return { ok: false, error: 'proof_missing' };

  const parsed = parseWalletProofMessage(message);
  if (
    !parsed ||
    parsed.intent !== args.intent ||
    parsed.address !== args.address ||
    (parsed.ref ?? undefined) !== (args.ref ?? undefined)
  ) {
    return { ok: false, error: 'proof_invalid' };
  }

  const age = args.now - parsed.issuedAt;
  if (age > WALLET_PROOF_TTL_MS || age < -WALLET_PROOF_SKEW_MS) return { ok: false, error: 'proof_expired' };

  if (!verifySep53(args.address, message, signature)) return { ok: false, error: 'proof_invalid' };
  return { ok: true };
}

/** Read `proof` off a parsed JSON body without trusting its shape. */
export function proofFromBody(body: unknown): Partial<WalletProof> | null {
  const proof = (body as { proof?: unknown } | null)?.proof;
  return proof && typeof proof === 'object' ? (proof as Partial<WalletProof>) : null;
}
