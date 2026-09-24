/**
 * The messages a shopper's wallet signs to prove it is theirs.
 *
 * Pollar's tokens are DPoP-bound to a key that never leaves the browser, so
 * the server cannot ask Pollar who is calling. What it can check is a SEP-53
 * signature over a message that names the wallet: for custodial (email,
 * Google) wallets Pollar signs only inside a live session, and an external
 * wallet signs only if its owner approves. Anything that trusts an address —
 * the logged-in cookie, the faucet, closing an escrow — asks for one of these.
 *
 * Each message names what it is for, so a signature for one purpose is
 * useless for another: a login proof cannot refund an order, a refund proof
 * for one order cannot touch another. It also names the moment and goes stale
 * after WALLET_PROOF_TTL_MS. The text is Spanish because an external wallet
 * shows it to the person signing.
 *
 * No imports: the browser bundle gets this file and none of the verifier.
 */

export const WALLET_PROOF_TTL_MS = 5 * 60_000;

/** Clocks disagree a little; a proof from slightly in the future is fine. */
export const WALLET_PROOF_SKEW_MS = 60_000;

export type WalletIntent = 'login' | 'faucet' | 'settle' | 'refund';

const INTENT_TEXT: Record<WalletIntent, string> = {
  login: 'iniciar sesión',
  faucet: 'cargar USDC de prueba',
  settle: 'confirmar la orden',
  refund: 'reembolsar la orden',
};

/** Intents that are about one order, and so carry its id. */
const NEEDS_REF: Record<WalletIntent, boolean> = { login: false, faucet: false, settle: true, refund: true };

export interface WalletProof {
  message: string;
  /** Base64 ed25519 over SHA-256("Stellar Signed Message:\n" + message). */
  signature: string;
}

/** Signs a message with the shopper's wallet; null when it could not. */
export type WalletSigner = (message: string) => Promise<string | null>;

export function walletProofMessage(intent: WalletIntent, address: string, issuedAt: number, ref?: string): string {
  const what = NEEDS_REF[intent] ? `${INTENT_TEXT[intent]} ${ref ?? ''}` : INTENT_TEXT[intent];
  return `Changuito: ${what} con ${address} (${new Date(issuedAt).toISOString()})`;
}

export interface ParsedWalletProof {
  intent: WalletIntent;
  address: string;
  issuedAt: number;
  ref?: string;
}

const PATTERN =
  /^Changuito: (iniciar sesión|cargar USDC de prueba|confirmar la orden|reembolsar la orden)(?: ([0-9a-f]{64}))? con ([A-Z0-9]{56}) \((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\)$/;

export function parseWalletProofMessage(message: string): ParsedWalletProof | null {
  const m = PATTERN.exec(message);
  if (!m) return null;
  const intent = (Object.keys(INTENT_TEXT) as WalletIntent[]).find((k) => INTENT_TEXT[k] === m[1])!;
  if (NEEDS_REF[intent] !== Boolean(m[2])) return null;
  const issuedAt = Date.parse(m[4]!);
  if (!Number.isFinite(issuedAt)) return null;
  return { intent, address: m[3]!, issuedAt, ...(m[2] ? { ref: m[2] } : {}) };
}

/** Build and sign in one step. Null when the wallet would not sign. */
export async function signWalletProof(
  sign: WalletSigner,
  intent: WalletIntent,
  address: string,
  ref?: string,
  now: number = Date.now(),
): Promise<WalletProof | null> {
  const message = walletProofMessage(intent, address, now, ref);
  try {
    const signature = await sign(message);
    return signature ? { message, signature } : null;
  } catch {
    return null;
  }
}
