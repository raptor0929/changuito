/**
 * The server, as a value rather than a side effect.
 *
 * This file used to be `index.ts`, which built an McpServer and connected it to
 * stdio the moment it was imported. That is fine for a CLI binary and useless
 * for anything else: a web app cannot import a module whose import *is* the
 * process. Splitting the construction out means the same server can be driven
 * over stdio by a desktop client and over an in-memory transport by a Next.js
 * route, with no second implementation to keep in sync.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getAdapter, listRetailers, RETAILER_IDS, UNSUPPORTED } from './adapters/registry.js';
import { ensureCart, getLocation, rememberCart, requireLocation, setLocation } from './session.js';
import { SERVER_INSTRUCTIONS } from './onboarding.js';
import type { Cart, Product } from './types.js';

const RetailerId = z.enum(RETAILER_IDS as unknown as [string, ...string[]]);

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true });

/** Compact rendering. Raw VTEX payloads are enormous and waste the model's context. */
function renderProducts(ps: Product[]): string {
  if (!ps.length) return 'No products matched.';
  return ps
    .map((p, i) => {
      const bits = [
        `${i + 1}. ${p.name}`,
        `   sku=${p.skuId} seller=${p.sellerId}  ${p.price.display}`,
      ];
      if (p.listPrice && p.listPrice.centavos > p.price.centavos) {
        bits[1] += ` (was ${p.listPrice.display})`;
      }
      if (!p.available) bits[1] += '  [OUT OF STOCK]';
      if (p.brand) bits.push(`   ${p.brand}${p.ean ? ` · EAN ${p.ean}` : ''}`);
      return bits.join('\n');
    })
    .join('\n');
}

function renderCart(cart: Cart, handoff?: string): string {
  if (!cart.lines.length) return 'Cart is empty.';
  const lines = cart.lines.map(
    (l) =>
      `  [${l.index}] ${l.name} ×${l.quantity} — ${l.lineTotal.display}` +
      `${l.available ? '' : '  [UNAVAILABLE]'}`,
  );
  const out = [`Cart at ${cart.retailer} (${cart.lines.length} lines):`, ...lines, `  TOTAL: ${cart.total.display}`];
  if (cart.messages.length) out.push(`Notes: ${cart.messages.join(' | ')}`);
  if (handoff) out.push(`\nOpen in browser to review and pay:\n${handoff}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- tools

/** Everything here is read-only: it never touches an account and never spends. */
export function registerCatalogTools(server: McpServer): void {
  server.registerTool(
    'list_retailers',
    {
      title: 'List supported supermarkets',
      description: 'Show which Argentine supermarkets this server can search and build carts for.',
      inputSchema: {},
    },
    async () => {
      const rows = listRetailers().map((r) => `  ${r.id.padEnd(10)} ${r.name} (${r.host})`);
      const un = Object.entries(UNSUPPORTED).map(([k, v]) => `  ${k.padEnd(10)} NOT SUPPORTED — ${v}`);
      return text(['Supported:', ...rows, '', ...un].join('\n'));
    },
  );

  server.registerTool(
    'set_location',
    {
      title: 'Choose supermarket and delivery area',
      description:
        'Required before searching. Picks the supermarket and resolves an Argentine postal code to a ' +
        'delivery region, so prices and stock match what the user would actually be charged.',
      inputSchema: {
        retailer: RetailerId.describe('Which supermarket, e.g. "carrefour".'),
        postal_code: z
          .string()
          .regex(/^[A-Za-z]?\d{4}([A-Za-z]{3})?$/, 'Expected an Argentine postal code like 1425 or C1425DKE.')
          .describe('Argentine postal code, e.g. "1425".'),
      },
    },
    async ({ retailer, postal_code }) => {
      try {
        const ctx = await getAdapter(retailer).resolveLocation(postal_code);
        setLocation(ctx);
        const out = [
          `Location set: ${retailer}, postal code ${postal_code}, sales channel ${ctx.salesChannel}.`,
        ];
        if (ctx.sellers.length) {
          out.push(`Delivering from ${ctx.sellers.length} seller(s): ${ctx.sellers.map((s) => s.name).slice(0, 4).join(', ')}.`);
        }
        if (ctx.degraded && ctx.note) out.push(`Note: ${ctx.note}`);
        return text(out.join('\n'));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'search_products',
    {
      title: 'Search the catalog',
      description:
        'Search the selected supermarket. Returns SKU ids — pass those to add_to_cart, not product names.',
      inputSchema: {
        query: z.string().min(1).describe('Spanish search terms, e.g. "leche descremada".'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results, default 12.'),
        offset: z.number().int().min(0).optional().describe('Skip this many, for paging.'),
        sort: z.enum(['relevance', 'price_asc', 'price_desc', 'discount']).optional(),
        include_unavailable: z.boolean().optional().describe('Include out-of-stock items. Default false.'),
      },
    },
    async ({ query, limit, offset, sort, include_unavailable }) => {
      try {
        const ctx = requireLocation();
        const products = await getAdapter(ctx.retailer).search(query, ctx, {
          limit, offset, sort, onlyAvailable: !include_unavailable,
        });
        return text(renderProducts(products));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'get_product',
    {
      title: 'Look up one SKU',
      description: 'Fetch current name, price and availability for a single SKU at the chosen location.',
      inputSchema: { sku_id: z.string().describe('SKU id from search_products.') },
    },
    async ({ sku_id }) => {
      try {
        const ctx = requireLocation();
        const p = await getAdapter(ctx.retailer).getProduct(sku_id, ctx);
        if (!p) return fail(`SKU ${sku_id} not found at ${ctx.retailer} for postal code ${ctx.postalCode}.`);
        return text(renderProducts([p]));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'price_check',
    {
      title: 'Check prices without touching the cart',
      description:
        'Verify real price, promotions and availability for a set of SKUs at the chosen location. ' +
        'Creates no cart and changes nothing — safe to call freely before committing.',
      inputSchema: {
        items: z
          .array(
            z.object({
              sku_id: z.string(),
              quantity: z.number().int().min(1).default(1),
              seller_id: z.string().default('1'),
            }),
          )
          .min(1),
      },
    },
    async ({ items }) => {
      try {
        const ctx = requireLocation();
        const cart = await getAdapter(ctx.retailer).priceCheck(
          items.map((i) => ({ skuId: i.sku_id, quantity: i.quantity, sellerId: i.seller_id })),
          ctx,
        );
        return text(renderCart(cart));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'add_to_cart',
    {
      title: 'Add products to the cart',
      description:
        'Add one or more SKUs to the cart, creating it on first use. Use the sku and seller from ' +
        'search_products. This does not buy anything.',
      inputSchema: {
        items: z
          .array(
            z.object({
              sku_id: z.string().describe('SKU id from search_products (NOT the product id).'),
              quantity: z.number().int().min(1).default(1),
              seller_id: z.string().default('1').describe('Seller id from search_products.'),
            }),
          )
          .min(1),
      },
    },
    async ({ items }) => {
      try {
        const { cart: current, ctx } = await ensureCart();
        const adapter = getAdapter(ctx.retailer);
        const cart = await adapter.addItems(
          current.cartId,
          items.map((i) => ({ skuId: i.sku_id, quantity: i.quantity, sellerId: i.seller_id })),
          ctx,
        );
        rememberCart(ctx.retailer, cart.cartId);
        return text(renderCart(cart));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'update_cart_item',
    {
      title: 'Change quantity or remove a line',
      description: 'Set the quantity of a cart line by its index. Quantity 0 removes it.',
      inputSchema: {
        index: z.number().int().min(0).describe('Line index shown by view_cart.'),
        quantity: z.number().int().min(0).describe('New quantity; 0 removes the line.'),
      },
    },
    async ({ index, quantity }) => {
      try {
        const { cart: current, ctx } = await ensureCart();
        const cart = await getAdapter(ctx.retailer).setQuantity(current.cartId, index, quantity, ctx);
        return text(renderCart(cart));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'view_cart',
    {
      title: 'Show the current cart',
      description: 'List everything in the cart with line indexes and the current total.',
      inputSchema: {},
    },
    async () => {
      try {
        const { cart } = await ensureCart();
        return text(renderCart(cart));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'get_cart_link',
    {
      title: 'Hand the cart to the user',
      description:
        'Return a URL that opens this cart in the browser. This is where the server stops: the ' +
        'user reviews, logs in and pays themselves. Nothing here places an order.',
      inputSchema: {},
    },
    async () => {
      try {
        const { cart, ctx } = await ensureCart();
        const url = getAdapter(ctx.retailer).handoffUrl(cart.cartId);
        if (!cart.lines.length) return text('Cart is empty — add something before handing it over.');
        return text(renderCart(cart, url));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'where_am_i',
    {
      title: 'Show current retailer and location',
      description: 'Report the active supermarket, postal code, sales channel and any degraded-mode warning.',
      inputSchema: {},
    },
    async () => {
      const ctx = getLocation();
      if (!ctx) return text('No location set yet. Call set_location first.');
      return text(
        [
          `Retailer:      ${ctx.retailer}`,
          `Postal code:   ${ctx.postalCode}`,
          `Sales channel: ${ctx.salesChannel}`,
          `Region:        ${ctx.regionId ?? '(none — store does not expose regions)'}`,
          `Sellers:       ${ctx.sellers.map((s) => s.name).join(', ') || '(none reported)'}`,
          ctx.degraded ? `\n⚠️  ${ctx.note}` : '',
        ].join('\n'),
      );
    },
  );
}

/**
 * Build a server with the catalog tools, and optionally the checkout half.
 *
 * `checkout` is a dynamic import on purpose. The checkout tools pull in
 * Playwright and an EVM signer, neither of which a read-only deployment can
 * use -- and a serverless bundle that carries a browser automation library it
 * will never run is a bundle that may not fit. Leaving it off means the module
 * is never reached, not merely never called.
 */
export interface ServerOptions {
  /** Default true. Set false for read-only hosts (serverless, browsers, CI). */
  checkout?: boolean;
  name?: string;
  version?: string;
}

export async function createSupermercadoServer(opts: ServerOptions = {}): Promise<McpServer> {
  // `instructions` is shown to the model once at connect. Twenty tool descriptions
  // say what each tool does; only this can say what order they go in and which two
  // things must never be asked of the user.
  const server = new McpServer(
    { name: opts.name ?? 'supermercado-mcp', version: opts.version ?? '0.2.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerCatalogTools(server);

  if (opts.checkout ?? true) {
    const { registerCheckoutTools } = await import('./tools.js');
    registerCheckoutTools(server);
  }

  return server;
}
