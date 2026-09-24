/**
 * The message a tester's wallet signs to use the faucet.
 *
 * Shared by the browser, which asks Pollar to sign it (SEP-53), and the
 * route, which checks it. It names the address and the moment, so a
 * signature proves "the holder of this wallet asked for demo USDC just now"
 * and nothing else: it cannot be replayed for another address, and it goes
 * stale after FAUCET_PROOF_TTL_MS.
 *
 * No imports: the browser bundle gets this file and nothing from the Stellar
 * SDK's verification path.
 */

export const FAUCET_PROOF_TTL_MS = 5 * 60_000;

/** Clocks disagree a little; a proof from slightly in the future is fine. */
export const FAUCET_PROOF_SKEW_MS = 60_000;

const PREFIX = 'Changuito: cargar USDC de prueba en ';

export function faucetProofMessage(address: string, issuedAt: number): string {
  return `${PREFIX}${address} (${new Date(issuedAt).toISOString()})`;
}

export function parseFaucetProofMessage(message: string): { address: string; issuedAt: number } | null {
  if (!message.startsWith(PREFIX)) return null;
  const m = /^([A-Z0-9]{56}) \((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\)$/.exec(message.slice(PREFIX.length));
  if (!m) return null;
  const issuedAt = Date.parse(m[2]!);
  return Number.isFinite(issuedAt) ? { address: m[1]!, issuedAt } : null;
}

/** What POST /api/faucet carries besides the address. */
export interface FaucetProof {
  message: string;
  /** Base64 ed25519 over SHA-256("Stellar Signed Message:\n" + message). */
  signature: string;
}

/**
 * GET /api/faucet?address=… — whether to show the button at all.
 *
 * `open` exists only outside production with no allowlist, so a fresh clone
 * can still fund a wallet. `allowlist` needs a signed proof on POST.
 */
export interface FaucetAccess {
  mode: 'open' | 'allowlist' | 'disabled';
  allowed: boolean;
}
