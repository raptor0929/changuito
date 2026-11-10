/**
 * The beta funnel, as short event names on top of lib/analytics.ts.
 *
 * login → faucet → cart_built → pay_open → settle | refund, with failure
 * along the way. Props are codes only: no email, DNI, password,
 * address, amount or free text ever goes out (sanitizeProps drops those too).
 */

export const FUNNEL_EVENTS = [
  'login',
  'faucet',
  'cart_built',
  'pay_open',
  'settle',
  'refund',
  'failure',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const PHASES = new Set(['queued', 'login', 'empty_cart', 'shop', 'checkout', 'payment']);

/** Why a run was refunded, as a code. Reads only fields that are not personal. */
export function refundFailureCode(s: {
  mode?: string | null;
  payment?: string | null;
  phase?: string | null;
  error?: string | null;
}): string {
  if (s.mode === 'demo') return 'demo';
  if (s.payment === 'declined') return 'declined';
  if (/recaptcha/i.test(s.error ?? '')) return 'recaptcha';
  if (s.payment === 'error') return 'payment_error';
  if (s.phase && PHASES.has(s.phase)) return `phase_${s.phase}`;
  return 'refund';
}

/** The message from lib/checkout/failure.ts openFailureMessage, as a code. */
export function lockFailureCode(message: string): string {
  if (/SOL suficiente/.test(message)) return 'insufficient_sol';
  if (/No te alcanza el USDC/.test(message)) return 'insufficient_usdc';
  if (/venció/.test(message)) return 'expired';
  if (/ya está abierto/.test(message)) return 'already_open';
  return 'lock_failed';
}
