import { recordManualEvent, resolveManualFee, workerAuthorized, sandboxRequest } from '../../../../lib/checkout/manual-server.ts';
import { validManualEvent } from '../../../../lib/checkout/manual-policy.ts';
import { db } from '../../../../lib/db.ts';
import type { CheckoutRecord } from '../../../../lib/checkout/store.ts';
import { startManual } from '../../../../lib/checkout/manual-start.ts';
import { readOrder } from '../../../../lib/checkout/escrow-server.ts';
import { recoverOpenAttempt } from '../../../../lib/checkout/open-recovery.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Called by the always-running worker, independently of the shopper's tab. */
export async function GET(req: Request): Promise<Response> {
  if (!workerAuthorized(req.headers.get('authorization'))) return new Response(null, { status: 401 });
  try {
    const rows = await db()`select record from manual_checkout
      where (record->>'openSig' is not null or record->>'openAttemptSig' is not null)
        and record->>'jobId' is null and record->>'outcome' is null
      order by (record->>'openSig' is not null) desc, updated_at limit 2`;
    for (const row of rows) {
      const rec = await recoverOpenAttempt(row.record as CheckoutRecord);
      if (!rec.openSig) {
        // Rotate unconfirmed attempts so they cannot hide a funded order.
        await db()`update manual_checkout set updated_at=now() where order_id=${rec.orderId}`;
        continue;
      }
      const order = await readOrder(rec.orderId);
      const expired = order && (order.status !== 'open' || order.deadline <= Date.now() / 1000 + 60);
      const result = expired ? null : await startManual(rec, null);
      if (expired || result?.status === 400 || result?.status === 403) {
        const stopped = await sandboxRequest(`/orders/${rec.orderId}/cancel`, { buyer: rec.buyer });
        const event = stopped.ok ? await stopped.json() : null;
        if (validManualEvent(event)) {
          const latest = await recordManualEvent(event);
          if (latest) await resolveManualFee(latest);
        }
      }
      break;
    }
    return Response.json({ ok: true });
  } catch { return Response.json({ ok: false }, { status: 202 }); }
}

export async function POST(req: Request): Promise<Response> {
  if (!workerAuthorized(req.headers.get('authorization'))) return new Response(null, { status: 401 });
  const raw = await req.text();
  if (raw.length > 4096) return new Response(null, { status: 413 });
  let event: unknown;
  try { event = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!validManualEvent(event)) return new Response(null, { status: 400 });
  try {
    const rec = await recordManualEvent(event);
    if (!rec || rec.checkoutKind !== 'manual_fee_v1') return new Response(null, { status: 404 });
    await resolveManualFee(rec);
    return Response.json({ resolved: true });
  } catch {
    return Response.json({ resolved: false }, { status: 202 });
  }
}
