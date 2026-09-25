/**
 * POST /api/order/verify — does the store agree that something happened?
 *
 * The checkout runs in a cross-origin frame, so when the shopper presses "Ya
 * lo pagué" the app has no way to check that from the browser: it cannot read
 * the frame's DOM, its URL, or anything else about it. This route is the
 * second opinion, taken server-side from VTEX's public orderForm endpoint.
 *
 * ## What it is worth, stated plainly
 *
 * It is **not** proof of payment, and no copy built on it may say that it is.
 * VTEX's public API does not expose an order to an unauthenticated reader; the
 * only thing it shows is the cart, and a paid cart is an empty cart. A shopper
 * who deleted their own items by hand produces exactly the same answer.
 *
 * What it does buy is that the store agrees the basket is closed. Without it,
 * a receipt would be written purely because a button was pressed — the app
 * taking the browser's word for a purchase, which is the one thing the whole
 * cross-origin design is trying not to do. So: the button is necessary, this
 * is corroboration, and `verified` says which of the two we got.
 */
import { orderFormIdFrom, readOrderForm } from '../../../../lib/order-check.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface VerifyResponse {
  /** The store agrees the cart is no longer payable. */
  verified: boolean;
  /** A profile is attached to the cart — a hint that the shopper logged in. */
  identified: boolean;
  /** Lines left in the cart. Zero, after a purchase. */
  items: number;
  /** True when we could not reach the store at all, as opposed to reaching it and disagreeing. */
  unknown: boolean;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const input = (body ?? {}) as { retailer?: unknown; handoffUrl?: unknown; itemsAtHandoff?: unknown };

  const retailer = typeof input.retailer === 'string' ? input.retailer : '';
  const handoffUrl = typeof input.handoffUrl === 'string' ? input.handoffUrl : '';
  const itemsAtHandoff = Number(input.itemsAtHandoff);
  const orderFormId = orderFormIdFrom(handoffUrl);

  if (!retailer || !orderFormId || !Number.isInteger(itemsAtHandoff) || itemsAtHandoff < 0) {
    return Response.json({ error: 'pedido inválido' }, { status: 400 });
  }

  const state = await readOrderForm({ retailer, orderFormId, itemsAtHandoff });
  if (!state) {
    // Unreachable is not "unpaid". The shopper is the one who knows, and the
    // flow continues on their word — this only failed to corroborate it.
    const body: VerifyResponse = { verified: false, identified: false, items: itemsAtHandoff, unknown: true };
    return Response.json(body);
  }

  const out: VerifyResponse = {
    verified: state.looksPaid,
    identified: state.identified,
    items: state.items,
    unknown: false,
  };
  return Response.json(out);
}
