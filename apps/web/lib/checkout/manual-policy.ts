export const MANUAL_KIND = 'manual_fee_v1' as const;
/** 0.10 USDC in a 7-decimal token. */
export const SERVICE_FEE_UNITS = '1000000';
export const SERVICE_FEE_CENTS = 10;
export const VIEWER_SECONDS = 900;

/**
 * Stable id for a manual fee: the domain, the buyer string, and the nonce.
 * The same inputs always hash the same, which is all the quote and the open
 * check have to agree on.
 */
export async function serviceOrderId(buyer: string, nonce: Uint8Array): Promise<string> {
  if (nonce.length !== 32) throw new Error('invalid nonce');
  const domain = new TextEncoder().encode('changuito/service-fee/v1');
  const who = new TextEncoder().encode(buyer);
  const bytes = new Uint8Array(domain.length + who.length + nonce.length);
  bytes.set(domain);
  bytes.set(who, domain.length);
  bytes.set(nonce, domain.length + who.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Preparation = 'queued' | 'preparing' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
export type Purchase = 'not_started' | 'in_progress' | 'verification_required' | 'placed' | 'declined' | 'unknown' | 'abandoned';
export interface ManualState {
  preparation: Preparation;
  purchase: Purchase;
  preparedAt: number | null;
  viewerExpiresAt: number | null;
  sessionActive: boolean;
  sequence: number;
}

export interface ManualEvent extends ManualState {
  order_id: string;
  job_id: string;
  phase: string;
  store_order_id: string | null;
}

export function feeVerdict(s: ManualState): 'settle' | 'refund' | null {
  if (s.preparedAt !== null) return 'settle';
  return ['failed', 'cancelled', 'interrupted'].includes(s.preparation) ? 'refund' : null;
}

export function validManualEvent(v: unknown): v is ManualEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as ManualEvent;
  return /^[0-9a-f]{64}$/.test(e.order_id) && /^[0-9a-f]{32}$/.test(e.job_id)
    && ['queued', 'preparing', 'ready', 'failed', 'cancelled', 'interrupted'].includes(e.preparation)
    && ['not_started', 'in_progress', 'verification_required', 'placed', 'declined', 'unknown', 'abandoned'].includes(e.purchase)
    && Number.isSafeInteger(e.sequence) && e.sequence > 0 && typeof e.sessionActive === 'boolean'
    && (e.preparedAt === null || (Number.isSafeInteger(e.preparedAt) && e.preparedAt > 0))
    && (e.viewerExpiresAt === null || (Number.isSafeInteger(e.viewerExpiresAt) && e.viewerExpiresAt > 0))
    && (e.preparedAt === null ? e.viewerExpiresAt === null && !e.sessionActive && e.preparation !== 'ready' && e.purchase === 'not_started'
      : e.preparation === 'ready' && e.viewerExpiresAt === e.preparedAt + VIEWER_SECONDS * 1000)
    && ['queued', 'login', 'empty_cart', 'shop', 'checkout', 'payment', 'placed'].includes(e.phase)
    && (e.store_order_id === null || /^[A-Za-z0-9_-]{1,100}$/.test(e.store_order_id));
}
