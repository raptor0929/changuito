import { ownedManual } from '../../../../lib/checkout/manual-auth.ts';
import { manualStatus, recordManualEvent, resolveManualFee, sandboxRequest } from '../../../../lib/checkout/manual-server.ts';
import { validManualEvent } from '../../../../lib/checkout/manual-policy.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const got = await ownedManual(req);
  if (!got.ok) return got.response;
  try {
    // The durable worker atomically decides whether readiness already occurred.
    // A tombstone also cancels an ambiguously timed-out initial start request.
    const response = await sandboxRequest(`/orders/${got.rec.orderId}/cancel`, { buyer: got.rec.buyer });
    const event = response.ok ? await response.json() : null;
    if (!validManualEvent(event) || event.order_id !== got.rec.orderId) throw new Error('unconfirmed cancel');
    const rec = await recordManualEvent(event);
    if (!rec) throw new Error('missing order');
    try { await resolveManualFee(rec); } catch { /* outbox will retry */ }
    return Response.json(manualStatus(rec), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Todavía no confirmamos el cierre. El pedido no se reintentará automáticamente.' }, { status: 503 });
  }
}
