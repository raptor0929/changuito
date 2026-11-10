import { readSessionUser, sessionMismatchResponse } from '../session-match.ts';
import { checkoutStore } from './store.ts';

export async function ownedManual(req: Request) {
  const user = await readSessionUser(req);
  if (!user.ok) return { ok: false, response: user.mismatch ? sessionMismatchResponse(req)
    : Response.json({ error: 'Iniciá sesión.' }, { status: 401 }) } as const;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) {
    return { ok: false, response: Response.json({ error: 'Origen inválido.' }, { status: 403 }) } as const;
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.orderId !== 'string' || !/^[0-9a-f]{64}$/.test(body.orderId)) {
    return { ok: false, response: Response.json({ error: 'Pedido inválido.' }, { status: 400 }) } as const;
  }
  const rec = await checkoutStore().get(body.orderId);
  if (!rec || rec.buyer !== user.address || rec.checkoutKind !== 'manual_fee_v1') {
    return { ok: false, response: Response.json({ error: 'Pedido no encontrado.' }, { status: 404 }) } as const;
  }
  const part = body.part === 'form' || body.part === 'screen' ? body.part : 'all';
  return { ok: true, rec, part } as const;
}
