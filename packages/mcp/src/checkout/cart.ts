import type { APIRequestContext } from 'playwright';

import {
  type VtexOrderForm,
  payableTotal,
  toCart,
  totalizerBreakdown,
} from '../adapters/orderform.js';
import type { AppConfig } from '../config.js';
import { log } from '../secure/redact.js';
import type { Cart } from '../types.js';
import { formatARS } from '../util/money.js';
import { apiGet, apiPost } from './browser.js';

/**
 * Putting the chosen products into the user's REAL cart.
 *
 * The important decision here is that we do not click "add to cart" on N
 * product pages. We call the store's own checkout API from inside the
 * authenticated browser context, so the request carries the user's cookies and
 * the items land in the cart they will see when they open the site themselves.
 * It is the same endpoint adapters/vtex.ts already uses anonymously — the only
 * difference is who is asking.
 *
 * That leaves the DOM for the steps that genuinely require it.
 */

export interface CartItemRequest {
  skuId: string;
  quantity: number;
  sellerId: string;
}

export interface PreExistingLine {
  skuId: string;
  name: string;
  quantity: number;
  lineTotal: string;
}

export interface BuildCartResult {
  orderFormId: string;
  cart: Cart;
  /** Items the user already had in the cart before we touched it. */
  preExisting: PreExistingLine[];
  /** Requested SKUs that did not end up in the cart, with the store's reason. */
  rejected: Array<{ skuId: string; reason: string }>;
  /** Store-side notices: price changed, partially out of stock, promo applied. */
  messages: string[];
  payableCentavos: number;
  breakdown: Array<{ id: string; name: string; centavos: number }>;
  handoffUrl: string;
  warnings: string[];
}

/** The sections we ask VTEX to return. Requesting them explicitly keeps one round trip. */
const SECTIONS = [
  'items',
  'totalizers',
  'clientProfileData',
  'shippingData',
  'paymentData',
  'messages',
  'storePreferencesData',
];

export function orderFormUrl(cfg: AppConfig, path = '', query = ''): string {
  return `https://${cfg.host}/api/checkout/pub/orderForm${path}${query}`;
}

export function handoffUrl(cfg: AppConfig, orderFormId: string): string {
  // Where the user takes over. Verified in phase 1: the /checkout/cart/add
  // deep link 404s on all four of these VTEX IO storefronts, so this is the
  // only route that actually opens a populated cart.
  return `https://${cfg.host}/checkout/?orderFormId=${orderFormId}#/cart`;
}

export async function fetchOrderForm(
  req: APIRequestContext,
  cfg: AppConfig,
  orderFormId?: string,
): Promise<VtexOrderForm> {
  const of = orderFormId
    ? await apiGet<VtexOrderForm>(req, orderFormUrl(cfg, `/${orderFormId}`, '?refreshOutdatedData=true'))
    : await apiGet<VtexOrderForm>(req, orderFormUrl(cfg, '', '?sc=1'));
  if (!of?.orderFormId) {
    throw new Error(
      'The store did not return a cart for this session. It may have been signed out — ' +
        'check session_status and re-link if needed.',
    );
  }
  return of;
}

export interface BuildCartOptions {
  /**
   * Empty the user's cart before adding. Default false: silently deleting
   * someone's shopping list is worse than telling them it is there.
   */
  clearFirst?: boolean;
  salesChannel?: string;
}

export async function buildCart(
  req: APIRequestContext,
  cfg: AppConfig,
  items: CartItemRequest[],
  opts: BuildCartOptions = {},
): Promise<BuildCartResult> {
  if (items.length === 0) throw new Error('No items to add.');
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1) {
      throw new Error(`Quantity for SKU ${it.skuId} must be a positive whole number, got ${it.quantity}.`);
    }
  }

  const sc = opts.salesChannel ?? '1';
  let of = await fetchOrderForm(req, cfg);
  const orderFormId = of.orderFormId as string;

  const preExisting: PreExistingLine[] = (of.items ?? []).map((it) => ({
    skuId: it.id,
    name: it.name || `SKU ${it.id}`,
    quantity: it.quantity,
    lineTotal: formatARS((it.sellingPrice ?? it.price ?? 0) * it.quantity),
  }));

  if (opts.clearFirst && preExisting.length > 0) {
    const cleared = await apiPost<VtexOrderForm>(
      req,
      orderFormUrl(cfg, `/${orderFormId}/items/removeAll`),
      { expectedOrderFormSections: SECTIONS },
    );
    if (!cleared.ok) {
      throw new Error(`Could not empty the existing cart (HTTP ${cleared.status}): ${cleared.error ?? ''}`);
    }
    of = cleared.body ?? of;
  }

  const res = await apiPost<VtexOrderForm>(
    req,
    orderFormUrl(cfg, `/${orderFormId}/items`, `?sc=${sc}`),
    {
      orderItems: items.map((it) => ({
        id: it.skuId,
        quantity: it.quantity,
        seller: it.sellerId,
      })),
      expectedOrderFormSections: SECTIONS,
    },
  );

  if (!res.ok || !res.body) {
    throw new Error(
      `The store refused to add the items (HTTP ${res.status}). ${res.error ?? ''}`.trim() +
        '\nIf this says the cart is not yours, the session has gone stale — re-link and try again.',
    );
  }

  of = res.body;
  const cart = toCart(of, cfg.retailer, orderFormId);

  // VTEX answers an add with the whole cart and no per-item verdict, so the
  // only honest way to report a failure is to diff what we asked for against
  // what came back.
  const rejected: Array<{ skuId: string; reason: string }> = [];
  for (const want of items) {
    const line = cart.lines.find((l) => l.skuId === want.skuId && l.sellerId === want.sellerId);
    if (!line) {
      rejected.push({ skuId: want.skuId, reason: 'not in the cart after the add — out of stock or not sold to this address' });
    } else if (!line.available) {
      rejected.push({ skuId: want.skuId, reason: 'added but marked unavailable' });
    } else if (line.quantity < want.quantity) {
      rejected.push({
        skuId: want.skuId,
        reason: `asked for ${want.quantity}, the store allowed ${line.quantity}`,
      });
    }
  }

  const warnings: string[] = [];
  if (preExisting.length > 0 && !opts.clearFirst) {
    warnings.push(
      `Your cart already had ${preExisting.length} item(s) in it: ` +
        preExisting.map((p) => `${p.quantity}× ${p.name}`).join(', ') +
        '. They are included in the total below and will be paid for too. ' +
        'Say so if you want them removed first.',
    );
  }
  if (rejected.length > 0) {
    warnings.push(`${rejected.length} requested item(s) did not go in — see the list.`);
  }

  log(`[cart] ${cart.lines.length} line(s) in orderForm ${orderFormId}, total ${cart.total.display}`);

  return {
    orderFormId,
    cart,
    preExisting,
    rejected,
    messages: cart.messages,
    payableCentavos: payableTotal(of),
    breakdown: totalizerBreakdown(of),
    handoffUrl: handoffUrl(cfg, orderFormId),
    warnings,
  };
}

/** Change a line's quantity; 0 removes it. Lines are addressed by index, not SKU. */
export async function setQuantity(
  req: APIRequestContext,
  cfg: AppConfig,
  orderFormId: string,
  index: number,
  quantity: number,
): Promise<Cart> {
  const res = await apiPost<VtexOrderForm>(req, orderFormUrl(cfg, `/${orderFormId}/items/update`), {
    orderItems: [{ index, quantity }],
    expectedOrderFormSections: SECTIONS,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Could not update line ${index} (HTTP ${res.status}). ${res.error ?? ''}`.trim());
  }
  return toCart(res.body, cfg.retailer, orderFormId);
}

/**
 * A human-readable review of the cart. This is what the user approves, so it
 * shows the payable total — items plus shipping plus discounts — not the
 * items subtotal.
 */
export function describeCart(r: BuildCartResult): string {
  const lines = r.cart.lines.map(
    (l) => `  ${l.quantity}× ${l.name}  ${l.lineTotal.display}${l.available ? '' : '  (UNAVAILABLE)'}`,
  );
  const parts = [`Cart at ${r.cart.retailer} (${r.cart.lines.length} lines):`, ...lines, ''];

  for (const t of r.breakdown) {
    parts.push(`  ${t.name.padEnd(24)} ${formatARS(t.centavos)}`);
  }
  parts.push(`  ${'TOTAL'.padEnd(24)} ${formatARS(r.payableCentavos)}`);

  if (r.messages.length) parts.push('', 'Store notices:', ...r.messages.map((m) => `  - ${m}`));
  if (r.rejected.length) {
    parts.push('', 'Not added:', ...r.rejected.map((x) => `  - ${x.skuId}: ${x.reason}`));
  }
  if (r.warnings.length) parts.push('', ...r.warnings.map((w) => `! ${w}`));
  parts.push('', `Open it yourself: ${r.handoffUrl}`);
  return parts.join('\n');
}
