import { StrKey } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';
import type { FaucetAccess, FaucetProof } from './faucet-proof.ts';
import { verifyWalletProof } from './wallet-proof-verify.ts';

/**
 * Who may mint demo USDC. Server-only.
 *
 * The faucet signs with our one admin key, so "anyone who can POST an
 * address" was "anyone on the internet". Now only the wallets listed in
 * FAUCET_ALLOWLIST_ADDRESSES may mint, and only with a fresh SEP-53 signature
 * from that wallet.
 *
 * Why a wallet address and not an email or a Pollar user id: those are
 * things the browser can say, not things the server can check. Pollar's
 * tokens are DPoP-bound to a key that never leaves the browser, so the server
 * cannot call Pollar as the user to learn who they are. A signature over a
 * message naming the address can be checked here with nothing but the
 * address — and for custodial (email, Google) wallets Pollar only produces
 * one for a logged-in session. Passkey smart wallets (C…) cannot sign
 * SEP-53, so testers use a custodial G… wallet.
 *
 * Deny by default: in production an empty list disables the faucet for
 * everyone, including Vercel previews, which also run as production.
 *
 * And it is per network, because free money is a testnet idea. See
 * `faucetOnNetwork`.
 */

export type FaucetMode = FaucetAccess['mode'];

/** Comma, space or newline separated; anything that is not a G… address is dropped. */
export function faucetAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.FAUCET_ALLOWLIST_ADDRESSES ?? '';
  const out = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const address = part.trim().toUpperCase();
    if (StrKey.isValidEd25519PublicKey(address)) out.add(address);
  }
  return out;
}

export function faucetMode(env: NodeJS.ProcessEnv = process.env): FaucetMode {
  if (faucetAllowlist(env).size > 0) return 'allowlist';
  return env.NODE_ENV === 'production' ? 'disabled' : 'open';
}

/**
 * Whether this network has a faucet at all.
 *
 * Read off `friendbotUrl` rather than comparing against 'testnet': the config
 * already records which chains hand out money, and a check written as data
 * stays right when a third network appears. On a public network there is no
 * friendbot and no mock token to mint — the faucet simply does not exist.
 */
export function faucetOnNetwork(net: NetworkId): boolean {
  return DEPLOYMENTS[net].friendbotUrl !== null;
}

export function faucetAccess(
  address: string,
  env: NodeJS.ProcessEnv = process.env,
  net: NetworkId = DEFAULT_NETWORK,
): FaucetAccess {
  if (!faucetOnNetwork(net)) return { mode: 'disabled', allowed: false };
  const mode = faucetMode(env);
  if (mode === 'open') return { mode, allowed: true };
  if (mode === 'disabled') return { mode, allowed: false };
  return { mode, allowed: faucetAllowlist(env).has(address) };
}

export type FaucetAuth =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string; message: string };

const deny = (status: 401 | 403, error: string, message: string): FaucetAuth => ({ ok: false, status, error, message });

/**
 * The whole decision, before friendbot or the mint run. Cheapest checks
 * first: a stranger's own address is refused without touching crypto.
 */
export function authorizeFaucet(args: {
  address: string;
  proof?: Partial<FaucetProof> | null;
  now: number;
  env?: NodeJS.ProcessEnv;
  net?: NetworkId;
}): FaucetAuth {
  const env = args.env ?? process.env;
  const net = args.net ?? DEFAULT_NETWORK;

  // Before the allowlist, because this one is not about who is asking. There
  // is nothing to mint on a public network, so the refusal is flat.
  if (!faucetOnNetwork(net)) {
    return deny(403, 'faucet_not_on_network', 'No hay carga de prueba en el modo real.');
  }

  const access = faucetAccess(args.address, env, net);

  if (access.mode === 'open') return { ok: true };
  if (access.mode === 'disabled') {
    return deny(403, 'faucet_disabled', 'La carga de USDC de prueba no está habilitada.');
  }
  if (!access.allowed) {
    return deny(403, 'faucet_not_allowed', 'Esta cuenta no puede cargar USDC de prueba.');
  }

  const proof = verifyWalletProof({ intent: 'faucet', address: args.address, proof: args.proof, now: args.now });
  if (!proof.ok) {
    if (proof.error === 'proof_missing') {
      return deny(401, 'faucet_session_required', 'Iniciá sesión con la cuenta de prueba para cargar USDC.');
    }
    if (proof.error === 'proof_expired') {
      return deny(401, 'faucet_proof_expired', 'La confirmación venció. Probá de nuevo.');
    }
    return deny(401, 'faucet_proof_invalid', 'No pudimos confirmar tu sesión. Probá de nuevo.');
  }
  return { ok: true };
}
