/**
 * GET /api/checkout/status?orderId=…  ->  StatusResponse
 *
 * The checkout dialog polls this every few seconds. Each poll asks the
 * sandbox how far it got and, when the job is over, closes the escrow:
 *
 *   - Día placed the order       -> settle: vault -> treasury, receipt on chain
 *   - anything else              -> refund: vault -> buyer
 *
 * "Anything else" includes a declined card, a card that was never tried (the
 * job carried no card because `shared_card` has no row) and a run that never reached payment.
 * A demo run (a wallet not on the card's member list) stops at payment on
 * purpose and still *settles* once it gets there: the treasury takes the
 * devnet USDC so the demo ends like a purchase, and the receipt's basis is
 * `demo-reached-payment`, not `sandbox-order-placed`. The reply carries the
 * cart link so the shopper finishes in Día.
 * The treasury keeps the USDC only when the operator's card actually paid
 * for the shopper's order; the receipt carries Día's order number.
 *
 * Idempotent by reading the chain first: a closed order is reported, never
 * closed again.
 */
import { createHash } from 'node:crypto';

import { readOrder, refundOrder, settleOrder } from '../../../../lib/checkout/escrow-server.ts';
import { refundReason } from '../../../../lib/checkout/failure.ts';
import { checkoutAlert, resolverFailureCode, resolverLogLine } from '../../../../lib/checkout/resolver-alert.ts';
import { readJob } from '../../../../lib/checkout/sandbox.ts';
import { checkoutStore, type CheckoutRecord } from '../../../../lib/checkout/store.ts';
import type { StatusResponse } from '../../../../lib/checkout/types.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';
import { canonicalReceipt } from '../../../../lib/order.ts';
import { manualStatus, recordManualEvent, resolveManualFee, sandboxRequest } from '../../../../lib/checkout/manual-server.ts';
import { validManualEvent } from '../../../../lib/checkout/manual-policy.ts';
import { recoverOpenAttempt } from '../../../../lib/checkout/open-recovery.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One close in flight per order per instance; the chain refuses a second anyway. */
const g = globalThis as { __chgClosing?: Set<string> };
const closing = (g.__chgClosing ??= new Set());

function reply(rec: CheckoutRecord, stage: StatusResponse['stage']): Response {
  const res: StatusResponse = {
    orderId: rec.orderId,
    stage,
    phase: rec.phase ?? null,
    payment: rec.payment ?? null,
    storeOrderId: rec.storeOrderId ?? null,
    openSig: rec.openSig ?? null,
    closeSig: rec.closeSig ?? null,
    handoffUrl: stage === 'done' || stage === 'refunded' ? rec.handoffUrl : null,
    amountDisplay: (rec.amountCents / 100).toFixed(2),
    error: rec.error ?? null,
    mode: rec.mode ?? null,
    alert: stage === 'shopping' ? checkoutAlert(rec, Date.now()) : null,
  };
  return Response.json(res, { headers: { 'cache-control': 'no-store' } });
}

/** Log an alert once per order, the first poll that sees it. No PII: lib/checkout/resolver-alert.ts. */
function noteAlert(rec: CheckoutRecord): void {
  const alert = checkoutAlert(rec, Date.now());
  if (!alert || rec.alertLogged === alert) return;
  rec.alertLogged = alert;
  console.error('[checkout/status]', JSON.stringify(resolverLogLine('checkout_alert', rec.orderId, alert, rec.closeFailures)));
}

export async function GET(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión.' }, { status: 401 });

  const orderId = new URL(req.url).searchParams.get('orderId') ?? '';
  if (!/^[0-9a-f]{64}$/.test(orderId)) return Response.json({ error: 'Pedido inválido.' }, { status: 400 });

  const store = checkoutStore();
  const rec = await store.get(orderId);
  if (!rec || rec.buyer !== user.address) return Response.json({ error: 'No encontramos ese pedido.' }, { status: 404 });
  if (rec.checkoutKind === 'manual_fee_v1') {
    let current = rec;
    try {
      current = await recoverOpenAttempt(rec);
      if (rec.jobId) {
        const result = await sandboxRequest(`/jobs/${rec.jobId}`);
        const event = result.ok ? await result.json() : null;
        if (validManualEvent(event) && event.order_id === rec.orderId && event.job_id === rec.jobId) {
          current = await recordManualEvent(event) ?? rec;
        }
      }
      await resolveManualFee(current);
    } catch { /* A lost worker is not proof of failure; durable outbox retries. */ }
    current = await store.get(rec.orderId) ?? current;
    return Response.json(manualStatus(current), { headers: { 'cache-control': 'no-store' } });
  }

  if (rec.outcome) return reply(rec, rec.outcome === 'settled' ? 'done' : 'refunded');
  if (!rec.jobId) return reply(rec, 'quoted');

  let finished: 'settle' | 'refund' | null = null;
  if (rec.jobId === 'none') {
    finished = 'refund';
  } else {
    try {
      const job = await readJob(rec.jobId);
      rec.phase = job.phase;
      if (job.status === 'done' || job.status === 'failed') {
        rec.payment = job.result?.payment ?? 'not_attempted';
        rec.storeOrderForm = job.result?.cart?.orderFormId;
        // A demo run that reached payment is a finished order too: the
        // treasury takes the (devnet) USDC as it would for a placed one, so
        // the demo ends the way a purchase does. Its receipt says what it was.
        const demoComplete = rec.mode === 'demo' && job.status === 'done' && job.result?.reached_payment === true;
        if ((job.status === 'done' && rec.payment === 'placed') || demoComplete) {
          finished = 'settle';
          rec.storeOrderId = job.result?.store_order_id ?? undefined;
        } else {
          finished = 'refund';
          rec.error = refundReason({
            status: job.status,
            payment: rec.payment,
            mode: rec.mode,
            detail: job.result?.payment_detail,
            phase: job.phase,
          });
        }
      }
    } catch (err) {
      // A sandbox we cannot reach is not yet a failed job; keep polling. The
      // buyer can still refund on chain once the deadline passes.
      console.error('[checkout/status] sandbox', err);
    }
  }

  if (!finished || closing.has(orderId)) {
    noteAlert(rec);
    await store.set(rec);
    return reply(rec, 'shopping');
  }

  closing.add(orderId);
  try {
    const order = await readOrder(orderId);
    if (!order) throw new Error('order account missing');
    if (order.status === 'open') {
      if (finished === 'settle') {
        const receipt =
          canonicalReceipt({
            orderId,
            buyer: order.buyer,
            basketHash: order.basketHash,
            amountUnits: order.amount.toString(),
            settledAt: new Date().toISOString(),
          }).replace('basis|buyer-confirmed', rec.mode === 'demo' ? 'basis|demo-reached-payment' : 'basis|sandbox-order-placed') +
          `job|${rec.jobId}\norderform|${rec.storeOrderForm ?? ''}\nstore-order|${rec.storeOrderId ?? ''}\n`;
        rec.closeSig = await settleOrder(order, createHash('sha256').update(receipt).digest());
      } else {
        rec.closeSig = await refundOrder(order);
      }
      rec.outcome = finished === 'settle' ? 'settled' : 'refunded';
    } else {
      rec.outcome = order.status === 'settled' ? 'settled' : 'refunded';
    }
    await store.set(rec);
    return reply(rec, rec.outcome === 'settled' ? 'done' : 'refunded');
  } catch (err) {
    rec.closeFailures = (rec.closeFailures ?? 0) + 1;
    console.error('[checkout/status]', JSON.stringify(resolverLogLine('resolver_close_failed', orderId, resolverFailureCode(err), rec.closeFailures)));
    noteAlert(rec);
    await store.set(rec);
    return reply(rec, 'shopping');
  } finally {
    closing.delete(orderId);
  }
}
