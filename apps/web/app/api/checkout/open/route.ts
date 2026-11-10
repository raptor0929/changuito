/**
 * Records that the buyer opened this order.
 *
 *   PUT /api/checkout/open { orderId, tx }  ->  { openSig }
 *
 * `tx` is the Stellar transaction hash. The buyer signed `escrow.open` in
 * the browser (WalletBridge). This route does not build or co-sign a
 * transaction: it checks the quote still belongs to this wallet and stores
 * the hash the status poll closes against.
 */
import { checkoutStore } from '../../../../lib/checkout/store.ts';
import { recoverOpenAttempt } from '../../../../lib/checkout/open-recovery.ts';
import { serviceOrderId, SERVICE_FEE_UNITS } from '../../../../lib/checkout/manual-policy.ts';
import { fromHex } from '../../../../lib/order.ts';
import { flagOn, getConfig } from '../../../../lib/config.ts';
import { manualAvailable, manualMember } from '../../../../lib/checkout/manual-server.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HASH = /^[0-9a-f]{64}$/i;

async function load(req: Request) {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return { ok: false as const, res: sessionMismatchResponse(req) };
  if (!user.ok) return { ok: false as const, res: Response.json({ error: 'Iniciá sesión para pagar.' }, { status: 401 }) };
  const body = (await req.json().catch(() => null)) as { orderId?: unknown; tx?: unknown } | null;
  const orderId = typeof body?.orderId === 'string' && HASH.test(body.orderId) ? body.orderId : null;
  if (!orderId) return { ok: false as const, res: Response.json({ error: 'Pedido inválido.' }, { status: 400 }) };
  const rec = await checkoutStore().get(orderId);
  if (!rec || rec.buyer !== user.address) {
    return { ok: false as const, res: Response.json({ error: 'No encontramos ese pedido.' }, { status: 404 }) };
  }
  return { ok: true as const, rec, tx: body?.tx };
}

export async function PUT(req: Request): Promise<Response> {
  const got = await load(req);
  if (!got.ok) return got.res;
  const rec = await recoverOpenAttempt(got.rec);
  if (rec.openSig) return Response.json({ openSig: rec.openSig });
  const openSig = typeof got.tx === 'string' && HASH.test(got.tx) ? got.tx : null;
  if (!openSig) return Response.json({ error: 'Falta la firma.' }, { status: 400 });
  if (rec.checkoutKind === 'manual_fee_v1') {
    if (!flagOn(await getConfig(), 'manual_checkout_enabled') || !await manualMember(rec.buyer) || !await manualAvailable()) {
      return Response.json({ error: 'El pago manual no está disponible.' }, { status: 503 });
    }
    if (rec.amount !== SERVICE_FEE_UNITS || !rec.orderNonce
        || await serviceOrderId(rec.buyer, fromHex(rec.orderNonce)) !== rec.orderId) {
      return Response.json({ error: 'Comisión inválida.' }, { status: 409 });
    }
  }
  rec.openSig = openSig;
  await checkoutStore().set(rec);
  return Response.json({ openSig });
}
