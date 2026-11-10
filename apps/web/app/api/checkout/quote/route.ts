/**
 * POST /api/checkout/quote { cart, handoffUrl? }  ->  QuoteResponse
 *
 * Turns the basket on screen into the arguments of `escrow.open`: a fresh
 * order id, the basket hash, and how much USDC to lock. The browser builds
 * the instruction from these and the shopper's wallet signs it; the server
 * never touches the buyer's money until it has the order on chain.
 *
 * The amount is the goods plus the envío, at belo's USDC rate
 * (lib/checkout/rate.ts). The envío comes from VTEX's simulation at the
 * shopper's postal code, picked by the same rule the sandbox uses at Día's
 * checkout (lib/checkout/shipping.ts), so the modal shows it as its own line
 * instead of hiding it in a buffer. QUOTE_BUFFER (default 0) adds slack on
 * top if a window's price starts moving between quote and run.
 */
import { arsToUsdCents } from '@changuito/mcp/fx';
import type { Cart } from '@changuito/mcp/types';

import { quoteRate } from '../../../../lib/checkout/rate.ts';
import { NO_DELIVERY, quoteShipping, type ShippingLocation } from '../../../../lib/checkout/shipping.ts';
import { checkoutStore } from '../../../../lib/checkout/store.ts';
import { sandboxFlags, getConfig, flagOn, memberFlow } from '../../../../lib/config.ts';
import { manualAvailable, manualStatus } from '../../../../lib/checkout/manual-server.ts';
import { MANUAL_KIND, SERVICE_FEE_CENTS, SERVICE_FEE_UNITS, serviceOrderId, VIEWER_SECONDS } from '../../../../lib/checkout/manual-policy.ts';
import { hasDatabase, db } from '../../../../lib/db.ts';
import type { CheckoutRecord } from '../../../../lib/checkout/store.ts';
import { getProfile } from '../../../../lib/profile.ts';
import { cardAccess, checkoutMode } from '../../../../lib/shared-card.ts';
import type { QuoteResponse } from '../../../../lib/checkout/types.ts';
import { DEFAULT_NETWORK } from '../../../../lib/deployments.ts';
import { contractIds } from '../../../../lib/contract-ids.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';
import { basketHash, DEFAULT_TIMEOUT_SECS, newOrderId, toHex } from '../../../../lib/order.ts';
import { centsToUnits } from '../../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buffer(): number {
  const b = Number(process.env.QUOTE_BUFFER ?? 0);
  return Number.isFinite(b) && b >= 0 && b <= 0.5 ? b : 0;
}

function isLocation(l: unknown): l is ShippingLocation {
  const x = l as ShippingLocation;
  return Boolean(x && typeof x.postalCode === 'string' && /^[A-Za-z0-9]{4,8}$/.test(x.postalCode));
}

function isCart(c: unknown): c is Cart {
  const x = c as Cart;
  return Boolean(x && typeof x.cartId === 'string' && Array.isArray(x.lines) && typeof x.total?.centavos === 'number');
}

export async function POST(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión para pagar.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { cart?: unknown; handoffUrl?: unknown; location?: unknown } | null;
  if (!isCart(body?.cart)) return Response.json({ error: 'Falta el changuito.' }, { status: 400 });
  const cart = body.cart;
  const lines = cart.lines.filter((l) => l.available && l.quantity > 0);
  if (lines.length === 0 || cart.total.centavos <= 0) {
    return Response.json({ error: 'El changuito está vacío.' }, { status: 400 });
  }

  // Resume funded sessions across a full app reload without another fee lock.
  const currentHash = toHex(await basketHash(cart));
  if (hasDatabase()) {
    try {
      const rows = await db()`select record from manual_checkout where record->>'buyer'=${user.address}
        and record->>'basketHash'=${currentHash} and (record->>'openSig' is not null or record->>'jobId' is not null)
        and (record->'manual'->>'sessionActive'='true' or
          (record->>'outcome' is null and (record->'manual'->>'preparedAt') is null))
        order by updated_at desc limit 1`;
      const rec = rows[0]?.record as CheckoutRecord | undefined;
      if (rec) return Response.json({
        checkoutKind: MANUAL_KIND, orderId: rec.orderId, orderNonce: rec.orderNonce, feeReleaseBasis: 'checkout_prepared',
        viewerDurationSecs: VIEWER_SECONDS, amount: rec.amount, amountCents: 10, amountDisplay: '0.10',
        basketHash: rec.basketHash, timeoutSecs: DEFAULT_TIMEOUT_SECS, arsPerUsd: rec.arsPerUsd,
        rateSource: rec.rateSource ?? '', subtotalCentavos: cart.total.centavos, shippingCentavos: rec.shippingCentavos ?? 0,
        totalCentavos: cart.total.centavos + (rec.shippingCentavos ?? 0), postalCode: rec.postalCode,
        postalSource: 'profile', chatPostalCode: null, programId: contractIds(DEFAULT_NETWORK).escrowId,
        usdcMint: contractIds(DEFAULT_NETWORK).usdcId, mode: 'live', resumeStatus: manualStatus(rec),
        ...(rec.manualFlow ? { manualFlow: rec.manualFlow } : {}),
      }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) { if ((err as { code?: string }).code !== '42P01') throw err; }
  }

  // Only wallets on the card's member list pay with it (lib/shared-card.ts).
  // Everyone else gets the demo run: same lock, the mock stops at payment,
  // refund, and the cart link to finish in Día. Asked here so the modal can
  // say which run this is before anything is locked; the start asks again.
  const config = await getConfig();
  const access = await cardAccess(user.address, (await sandboxFlags()).mock);
  const mode = checkoutMode(access);
  const manual = access === 'ok' && flagOn(config, 'manual_checkout_enabled');
  const manualFlow = memberFlow(manual, config);
  if (manual && (!hasDatabase() || !(await manualAvailable()))) {
    return Response.json({ error: 'El navegador de pago no está disponible. Probá más tarde.' }, { status: 503 });
  }

  // The postal code the shopper browsed with: prices, stock and envío are all quoted per area.
  // The profile's postcode wins over the chat's: it is where the shopper said
  // they live, and where the sandbox will deliver.
  let saved: string | undefined;
  try {
    saved = (await getProfile(user.address))?.postcode;
  } catch (err) {
    console.warn('[checkout] profile unreadable for quote', err instanceof Error ? err.name : err);
  }
  const chatPostal = isLocation(body.location) ? body.location.postalCode : undefined;
  if (saved) body.location = { ...(isLocation(body.location) ? body.location : {}), postalCode: saved };
  if (!isLocation(body.location)) {
    return Response.json({ error: 'Falta tu código postal. Contale al chat dónde estás y volvé a intentar.' }, { status: 400 });
  }
  const location = body.location;

  const override = Number(process.env.ARS_PER_USD);
  let rate, shipping;
  try {
    [rate, shipping] = await Promise.all([
      quoteRate(Number.isFinite(override) && override > 0 ? { override } : {}),
      quoteShipping(cart.retailer, lines, location),
    ]);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn('[checkout] quote failed', why);
    if (why.startsWith(NO_DELIVERY)) {
      return Response.json({ error: 'Día no hace envíos a domicilio a tu código postal.' }, { status: 409 });
    }
    return Response.json({ error: 'No pudimos cotizar el envío o el cambio. Probá de nuevo en un rato.' }, { status: 503 });
  }
  const totalCentavos = cart.total.centavos + shipping.centavos;
  const cents = manual ? SERVICE_FEE_CENTS : arsToUsdCents(totalCentavos as never, rate.arsPerUsd, buffer()) as unknown as number;
  const nonce = newOrderId();
  const orderId = manual ? await serviceOrderId(user.address, nonce) : toHex(nonce);
  const units = manual ? SERVICE_FEE_UNITS : centsToUnits(Math.round(cents)).toString();
  const manualFields = manual ? {
    checkoutKind: MANUAL_KIND, orderNonce: toHex(nonce),
    manual: { preparation: 'queued' as const, purchase: 'not_started' as const,
      preparedAt: null, viewerExpiresAt: null, sessionActive: false, sequence: 0 },
  } : {};
  const hash = currentHash;
  const handoffUrl =
    typeof body.handoffUrl === 'string' && /^https:\/\//.test(body.handoffUrl) ? body.handoffUrl : null;

  await checkoutStore().set({
    ...manualFields,
    orderId,
    buyer: user.address,
    amount: units,
    amountCents: cents,
    basketHash: hash,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    shippingCentavos: shipping.centavos,
    postalCode: location.postalCode,
    totalDisplay: cart.total.display,
    retailer: cart.retailer,
    lines: lines.map((l) => ({ name: l.name, skuId: l.skuId, quantity: l.quantity, lineTotal: l.lineTotal.display })),
    handoffUrl,
    createdAt: Date.now(),
    mode,
    ...(manualFlow ? { manualFlow } : {}),
  });

  const res: QuoteResponse = {
    ...(manual ? { checkoutKind: MANUAL_KIND, orderNonce: toHex(nonce),
      feeReleaseBasis: 'checkout_prepared' as const, viewerDurationSecs: VIEWER_SECONDS,
      ...(manualFlow ? { manualFlow } : {}) } : {}),
    orderId,
    amount: units,
    amountCents: cents,
    amountDisplay: (cents / 100).toFixed(2),
    basketHash: hash,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    subtotalCentavos: cart.total.centavos,
    shippingCentavos: shipping.centavos,
    totalCentavos,
    postalCode: location.postalCode,
    postalSource: saved ? 'profile' : 'chat',
    chatPostalCode: chatPostal ?? null,
    programId: contractIds(DEFAULT_NETWORK).escrowId,
    usdcMint: contractIds(DEFAULT_NETWORK).usdcId,
    mode,
  };
  return Response.json(res);
}
