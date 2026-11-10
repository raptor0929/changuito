import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';
import type { FaucetAccess, FaucetProof } from './faucet-proof.ts';
import { verifyWalletProof } from './wallet-proof-verify.ts';

/**
 * Who may mint demo USDC. Server-only.
 *
 * The list is not an environment variable. `config.faucet_open_to_all` and
 * the `wallet.faucet_allowed` column are the whole of it, and a banned row
 * wins over both. This module only checks the two things that are not that
 * row: the network has a faucet, and the wallet signed a fresh SEP-53 proof.
 * The caller decides `admitted` from the database.
 *
 * The proof is not waived when the faucet is open to every wallet. The
 * grants share one hourly ceiling, so an unsigned request is a way to spend
 * that ceiling. A signature over a message naming the address can be checked
 * here with nothing but the address. Passkey smart wallets (C…) cannot sign
 * SEP-53, so testers use a custodial G… wallet.
 *
 * And it is per network, because free money is a testnet idea. See
 * `faucetOnNetwork`.
 */

export type FaucetMode = FaucetAccess['mode'];

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

/** What GET /api/faucet tells the widget. `admitted` already includes the ban. */
export function faucetView(net: NetworkId, opts: { admitted: boolean; openToAll: boolean }): FaucetAccess {
  if (!faucetOnNetwork(net)) return { mode: 'disabled', allowed: false };
  if (!opts.admitted) return { mode: opts.openToAll ? 'public' : 'disabled', allowed: false };
  return { mode: opts.openToAll ? 'public' : 'allowlist', allowed: true };
}

export type FaucetAuth =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string; message: string };

const deny = (status: 401 | 403, error: string, message: string): FaucetAuth => ({ ok: false, status, error, message });

/**
 * The network and the signature. Who is admitted is the database's answer,
 * passed in. A wallet that is not admitted is refused before the proof.
 */
export function authorizeFaucet(args: {
  address: string;
  proof?: Partial<FaucetProof> | null;
  now: number;
  net?: NetworkId;
  admitted: boolean;
}): FaucetAuth {
  const net = args.net ?? DEFAULT_NETWORK;

  if (!faucetOnNetwork(net)) {
    return deny(403, 'faucet_not_on_network', 'No hay carga de prueba en el modo real.');
  }
  if (!args.admitted) {
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
