import { checkoutStore, type CheckoutRecord } from './store.ts';
import { manualMember, manualStatus, sandboxRequest } from './manual-server.ts';
import { SERVICE_FEE_UNITS } from './manual-policy.ts';
import { readOrder } from './escrow-server.ts';
import { readShopper } from './shopper.ts';
import { getConfig, manualCheckoutFlow } from '../config.ts';
import { getProfile } from '../profile.ts';

export async function startManual(rec: CheckoutRecord, body: { dia?: unknown; address?: unknown; openSig?: unknown } | null): Promise<Response> {
  if (!await manualMember(rec.buyer)) return Response.json({ error: 'Acceso no autorizado.' }, { status: 403 });
  if (rec.jobId) return Response.json(manualStatus(rec));
  const flow = manualCheckoutFlow(await getConfig());
  const order = await readOrder(rec.orderId);
  if (!order || order.status !== 'open' || order.buyer !== rec.buyer
      || order.amount !== BigInt(SERVICE_FEE_UNITS) || order.basketHash !== rec.basketHash) {
    return Response.json({ error: 'La comisión bloqueada no coincide con el pedido.' }, { status: 409 });
  }
  const profile = await getProfile(rec.buyer);
  const shopper = readShopper(body?.dia ?? profile, { ...profile, ...Object.fromEntries(Object.entries((body?.address ?? {}) as object).filter(([, v]) => typeof v === 'string' && v.trim())) }, rec.postalCode);
  if (!shopper) return Response.json({ error: 'Completá tus datos de Día.' }, { status: 400 });
  // A start timeout is an unknown outcome. Retrying is safe because the worker
  // has a durable UNIQUE(order_id), unlike a memory-only job-id map.
  try {
    const response = await sandboxRequest('/jobs', {
      mode: 'manual', order_id: rec.orderId, buyer: rec.buyer, shopper, escrow_deadline: order.deadline,
      flow,
      items: rec.lines.map(l => ({ name: l.name, quantity: l.quantity, sku: l.skuId })),
    });
    if (!response.ok) return Response.json({ error: 'No pudimos preparar el navegador. Reintentá o cancelá.' }, { status: 503 });
    const result = await response.json();
    if (typeof result.job_id !== 'string' || !/^[0-9a-f]{32}$/.test(result.job_id)) throw new Error('invalid job');
    const persisted = result.flow === 'guided' || result.flow === 'headless' || result.flow === 'viewer' ? result.flow : flow;
    // An early worker event may already have advanced the durable record.
    const current = await checkoutStore().get(rec.orderId) ?? rec;
    current.jobId = result.job_id;
    current.manualFlow = persisted;
    current.startedAt ??= Date.now();
    current.openSig = typeof body?.openSig === 'string' ? body.openSig : current.openSig;
    await checkoutStore().set(current);
    return Response.json(manualStatus(current), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'No pudimos confirmar el inicio. Reintentá con el mismo pedido.' }, { status: 503 });
  }
}
