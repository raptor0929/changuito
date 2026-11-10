import type { StatusResponse } from './types.ts';

type Request = (url: string, init: RequestInit) => Promise<Response>;
export interface OpenSubmission { orderId: string; tx: string }
export interface OpenResult { openSig: string; status?: StatusResponse }

/** A lost reply says nothing about whether the already-signed lock landed. */
export class OpenConfirmationPending extends Error {}

export async function recoverOpen(request: Request, orderId: string): Promise<OpenResult | null> {
  try {
    const res = await request(`/api/checkout/status?orderId=${orderId}`, {
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    const status = await res.json() as StatusResponse;
    if (!res.ok || status.orderId !== orderId || typeof status.openSig !== 'string' || !status.openSig) return null;
    return { openSig: status.openSig, status };
  } catch { return null; }
}

/** Retrying uses these same signed bytes and order, never another wallet approval. */
export async function submitOpen(request: Request, submission: OpenSubmission, failure: string): Promise<OpenResult> {
  let rejection: string | null = null;
  try {
    const res = await request('/api/checkout/open', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submission), signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && typeof body?.openSig === 'string' && body.openSig) return { openSig: body.openSig };
    // A rejected signature/message was never submitted. Other failures may be
    // a transport failure after broadcasting and must be reconciled first.
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      rejection = typeof body?.error === 'string' ? body.error : failure;
    }
  } catch { /* Check the durable order after a missing or interrupted reply. */ }
  const recovered = await recoverOpen(request, submission.orderId);
  if (recovered) return recovered;
  if (rejection) throw new Error(rejection);
  throw new OpenConfirmationPending(failure);
}
