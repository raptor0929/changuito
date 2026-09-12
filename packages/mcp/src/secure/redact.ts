/**
 * Everything that leaves this process — log lines, MCP tool responses, error
 * messages, the page extract we send to Jev — goes through here first.
 *
 * Two mechanisms, deliberately layered, because neither is sufficient alone:
 *
 *   1. EXACT MATCH (`registerSecret`). When we hold a real secret in memory — a
 *      PAN from GET /cards/{id}/details, a CVV, a 3DS OTP, a decrypted private
 *      key — we register the literal string. Anything containing it is masked,
 *      no pattern matching involved. This is the reliable guarantee.
 *
 *   2. HEURISTICS. Patterns for secrets we never registered because they came
 *      from somewhere we did not anticipate. Defence in depth, not the plan.
 *
 * The hard rule for this file: it must never throw. It sits inside the logger
 * and inside the payment path, and a crash here either loses the audit trail or
 * kills a run mid-payment. Every public function is wrapped; on any internal
 * failure we mask everything rather than risk leaking.
 */

const MASK = '[REDACTED]';

/** Live secrets, newest first. Held only as long as the run needs them. */
const secrets = new Map<string, string>();

/**
 * Register a literal secret so every later redaction masks it by exact match.
 * `label` only shapes the placeholder, e.g. "pan" -> [REDACTED:pan].
 * Values shorter than 4 chars are ignored: masking "1" would shred every log.
 * This means a three-digit CVV never enters the registry — it is guarded by
 * SENSITIVE_KEY below instead, and by never being written as a bare string.
 */
export function registerSecret(value: string | undefined | null, label: string): void {
  if (!value || value.length < 4) return;
  secrets.set(value, `[REDACTED:${label}]`);
}

/** Drop a secret once it can no longer appear. Call in a `finally`. */
export function forgetSecret(value: string | undefined | null): void {
  if (value) secrets.delete(value);
}

/** Clear every registered secret. Used between runs and in tests. */
export function forgetAllSecrets(): void {
  secrets.clear();
}

/**
 * Object keys whose VALUE is masked wholesale regardless of what it looks like.
 * Key-aware masking is how DNI is handled: an Argentine DNI is 7-8 digits, and
 * so is a cart total in centavos (1527177 == $15.271,77). Masking every 7-8
 * digit number would destroy our own price logs, so DNI is only masked when the
 * key says it is one.
 */
const SENSITIVE_KEY = new RegExp(
  [
    'pan', 'cardnumber', 'card_number', 'cvv', 'cvc', 'securitycode',
    'password', 'passphrase', 'secret', 'token', 'apikey', 'api_key',
    'privatekey', 'private_key', 'mnemonic', 'seed',
    'authorization', 'cookie', 'setcookie', 'storagestate',
    'otp', 'onetimecode',
    'document', 'documentid', 'dni', 'cuit', 'cuil',
  ].join('|'),
  'i',
);

/** A 4-digit-group card number with optional spaces or dashes, or a bare run. */
const PAN_LIKE = /\b(?:\d[ -]?){12,18}\d\b/g;
/** Vyrion API keys. */
const API_KEY = /\bsk_(?:test|live)_[A-Za-z0-9_-]{8,}\b/g;
/** An EVM private key, with or without the 0x. */
const HEX_KEY = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
/** Bearer tokens in a header string. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Luhn check. Used to tell a real card number from a number that merely has the
 * right number of digits — Date.now() is 13 digits and would otherwise be
 * masked on every log line. A random 13-19 digit run passes Luhn about 10% of
 * the time, so this removes roughly 90% of false positives at zero cost to
 * true positives: every real PAN passes by construction.
 */
export function looksLikeCardNumber(digits: string): boolean {
  const d = digits.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** PCI permits showing the last four. Keeping them makes logs debuggable. */
const maskPan = (raw: string): string => {
  const d = raw.replace(/[ -]/g, '');
  return `[REDACTED:pan ****${d.slice(-4)}]`;
};

function scrubString(input: string): string {
  let s = input;

  // Exact matches first: these are certainties, the patterns below are guesses.
  for (const [secret, placeholder] of secrets) {
    if (s.includes(secret)) s = s.split(secret).join(placeholder);
  }

  s = s.replace(API_KEY, '[REDACTED:apikey]');
  s = s.replace(BEARER, 'Bearer [REDACTED:token]');
  s = s.replace(HEX_KEY, '[REDACTED:key]');
  s = s.replace(PAN_LIKE, (m) => (looksLikeCardNumber(m) ? maskPan(m) : m));

  return s;
}

function scrub(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) return '[REDACTED:too-deep]';
  if (value == null) return value;

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[fn]';

  if (value instanceof Error) {
    const e = new Error(scrubString(value.message));
    e.name = value.name;
    e.stack = value.stack ? scrubString(value.stack) : undefined;
    return e;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) return value.map((v) => scrub(v, seen, depth + 1));
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value].map(([k, v]) => [String(k), scrub(v, seen, depth + 1)]),
      );
    }
    if (value instanceof Set) return [...value].map((v) => scrub(v, seen, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? MASK : scrub(v, seen, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * Redact anything. Returns the same shape with secrets masked.
 * Never throws: on an internal error it masks the whole value instead.
 */
export function redact<T>(value: T): T {
  try {
    return scrub(value, new WeakSet(), 0) as T;
  } catch {
    return MASK as unknown as T;
  }
}

/** Redact and render as a single line, for logs. */
export function redactToString(value: unknown): string {
  try {
    const r = redact(value);
    return typeof r === 'string' ? r : JSON.stringify(r);
  } catch {
    return MASK;
  }
}

/**
 * The only logger this project should use. Goes to stderr because stdout is the
 * MCP stdio transport — anything written there corrupts the protocol.
 */
export function log(...parts: unknown[]): void {
  console.error(parts.map(redactToString).join(' '));
}
