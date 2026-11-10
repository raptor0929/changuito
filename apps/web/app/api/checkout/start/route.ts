/**
 * POST /api/checkout/start { orderId, openSig?, dia: {email, password, dni}, address? }  ->  StatusResponse
 *
 * Called after the shopper's wallet sent `open`. The server believes the
 * chain, not the browser: the Order account must exist, belong to the cookie's
 * wallet, be open, lock at least the quoted amount and commit to the quoted
 * basket. Only then does the sandbox start spending effort on it.
 *
 * `dia` is the shopper's Día login: the sandbox buys in their account, so the
 * order is theirs and goes to their address. When the body has none, the
 * saved profile is decrypted here instead. Either way it goes to `startJob`
 * and is dropped — never written to the checkout record, never logged. A
 * password in a cache with a 24 hour expiry is still a password in a cache.
 *
 * A wallet that may not pay with the shared card gets the demo run instead
 * (lib/shared-card.ts `checkoutMode`, asked again here because this is the
 * check that counts): the mock, stopping at payment, so the order refunds and
 * the modal hands off to the cart link. It needs no Día login.
 *
 * Idempotent: a second call for an order that already has a job returns the
 * same status rather than starting a second job.
 */
import { readOrder } from '../../../../lib/checkout/escrow-server.ts';
import { startJob } from '../../../../lib/checkout/sandbox.ts';
import { readShopper } from '../../../../lib/checkout/shopper.ts';
import { sandboxFlags } from '../../../../lib/config.ts';
import { getProfile } from '../../../../lib/profile.ts';
import { cardAccess, checkoutCardFor, checkoutMode } from '../../../../lib/shared-card.ts';
import type { SandboxShopper } from '../../../../lib/checkout/sandbox.ts';
import { checkoutStore } from '../../../../lib/checkout/store.ts';
import type { StatusResponse } from '../../../../lib/checkout/types.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';
import { startManual } from '../../../../lib/checkout/manual-start.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión para pagar.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    orderId?: unknown;
    openSig?: unknown;
    dia?: unknown;
    address?: unknown;
  } | null;
  const orderId = typeof body?.orderId === 'string' && /^[0-9a-f]{64}$/.test(body.orderId) ? body.orderId : null;
  if (!orderId) return Response.json({ error: 'Pedido inválido.' }, { status: 400 });

  const store = checkoutStore();
  const rec = await store.get(orderId);
  if (!rec || rec.buyer !== user.address) return Response.json({ error: 'No encontramos ese pedido.' }, { status: 404 });
  if (rec.checkoutKind === 'manual_fee_v1') return startManual(rec, body);

  if (!rec.jobId) {
    const flags = await sandboxFlags();
    // Fails closed: an unreadable member list is a demo, never the card.
    const mode = checkoutMode(await cardAccess(user.address, flags.mock).catch(() => 'not-member' as const));

    // A login typed into the modal wins for this one checkout; otherwise the
    // saved profile, decrypted here and nowhere else (lib/profile.ts). The
    // demo run never logs in, so it asks for neither.
    let shopper: SandboxShopper | undefined;
    if (mode !== 'demo') shopper = readShopper(body?.dia, body?.address, rec.postalCode);
    if (mode !== 'demo' && !shopper) {
      try {
        shopper = readShopper(await getProfile(user.address), body?.address, rec.postalCode);
      } catch (err) {
        console.error('[checkout/start] profile', err instanceof Error ? err.name : 'read failed');
        return Response.json({ error: 'No pudimos leer tu perfil. Probá de nuevo en un rato.' }, { status: 503 });
      }
    }
    if (mode !== 'demo' && !shopper) {
      return Response.json({ error: 'Completá tu email, contraseña y DNI de Día.' }, { status: 400 });
    }
    // A just-confirmed transaction can lag one RPC node behind another.
    let order = await readOrder(orderId);
    for (let i = 0; !order && i < 4; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      order = await readOrder(orderId);
    }
    if (!order) return Response.json({ error: 'Todavía no vemos el pago en la red.' }, { status: 409 });
    if (order.buyer !== rec.buyer) return Response.json({ error: 'El pago no es de esta billetera.' }, { status: 403 });
    if (order.status !== 'open') return Response.json({ error: 'Ese pedido ya está cerrado.' }, { status: 409 });
    if (order.amount < BigInt(rec.amount)) return Response.json({ error: 'El monto bloqueado no alcanza.' }, { status: 409 });
    if (order.basketHash !== rec.basketHash) {
      return Response.json({ error: 'El changuito bloqueado no es el cotizado.' }, { status: 409 });
    }

    rec.openSig = typeof body?.openSig === 'string' ? body.openSig : rec.openSig;
    rec.mode = mode;
    const items = rec.lines.map((l) => ({ name: l.name, quantity: l.quantity, sku: l.skuId }));
    try {
      if (mode === 'demo') {
        rec.jobId = await startJob(orderId, items, undefined, undefined, flags, process.env, { demo: true });
        console.log('[checkout/start] demo run: not a card member');
      } else {
        // The operator's card, from shared_card, and only for a wallet on its
        // member list (the quote already said so; this is the check that
        // counts). None means the run stops at the payment step and refunds;
        // a failed read is the same, not a 500.
        const card = await checkoutCardFor(user.address).catch((err) => {
          console.error('[checkout/start] card', err instanceof Error ? err.name : 'read failed');
          return undefined;
        });
        if (card) console.log('[checkout/start] paying with the shared card on', card.network);
        rec.jobId = await startJob(
          orderId,
          items,
          shopper,
          card && {
            pan: card.pan,
            cvv: card.cvv,
            exp_month: card.exp_month,
            exp_year: card.exp_year,
            holder: card.holder,
            kind: card.kind,
          },
          flags,
        );
      }
    } catch (err) {
      // No job means nothing will settle it: the status poll refunds.
      // The error is ours (status, network); the request body is never in it.
      console.error('[checkout/start]', err instanceof Error ? err.message : 'startJob failed');
      rec.error = 'No pudimos arrancar la compra.';
      rec.jobId = 'none';
    }
    rec.phase = 'queued';
    rec.startedAt = Date.now();
    await store.set(rec);
  }

  const res: StatusResponse = {
    orderId,
    stage: 'shopping',
    phase: rec.phase ?? null,
    payment: rec.payment ?? null,
    storeOrderId: rec.storeOrderId ?? null,
    openSig: rec.openSig ?? null,
    closeSig: null,
    handoffUrl: null,
    amountDisplay: (rec.amountCents / 100).toFixed(2),
    error: rec.error ?? null,
    mode: rec.mode ?? null,
    alert: null,
  };
  return Response.json(res);
}
