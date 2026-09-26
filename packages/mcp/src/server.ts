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
import { defaultSession, type SessionState } from './session.js';
import { CATALOG_INSTRUCTIONS } from './onboarding.js';
import { CartLinkOutput, CartOutput, ProductsOutput } from './schemas.js';
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

/**
 * Everything here is read-only: it never touches an account and never spends.
 *
 * `session` is a parameter rather than a module import so one process can host
 * several shoppers at once. The default keeps the stdio binary's behaviour,
 * where one process is one user and sharing is not a concern.
 */
export function registerCatalogTools(
  server: McpServer,
  session: SessionState = defaultSession,
): void {
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
        session.setLocation(ctx);
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
      outputSchema: ProductsOutput,
    },
    async ({ query, limit, offset, sort, include_unavailable }) => {
      try {
        const ctx = session.requireLocation();
        const products = await getAdapter(ctx.retailer).search(query, ctx, {
          limit, offset, sort, onlyAvailable: !include_unavailable,
        });
        return { ...text(renderProducts(products)), structuredContent: { products } };
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
        const ctx = session.requireLocation();
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
        const ctx = session.requireLocation();
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
        'search_products. This does not buy anything. Returns the cart as it now stands, so the ' +
        'caller never has to re-read it to know what changed.',
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
      outputSchema: CartOutput,
    },
    async ({ items }) => {
      try {
        const { cart: current, ctx } = await session.ensureCart();
        const adapter = getAdapter(ctx.retailer);
        const cart = await adapter.addItems(
          current.cartId,
          items.map((i) => ({ skuId: i.sku_id, quantity: i.quantity, sellerId: i.seller_id })),
          ctx,
        );
        session.rememberCart(ctx.retailer, cart.cartId);
        return { ...text(renderCart(cart)), structuredContent: { cart } };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'update_cart_item',
    {
      title: 'Change quantity or remove a line',
      description:
        'Set the quantity of a cart line by its index. Quantity 0 removes it. Returns the ' +
        'cart as it now stands, so the caller never has to re-read it to know what changed.',
      inputSchema: {
        index: z.number().int().min(0).describe('Line index shown by view_cart.'),
        quantity: z.number().int().min(0).describe('New quantity; 0 removes the line.'),
      },
      outputSchema: CartOutput,
    },
    async ({ index, quantity }) => {
      try {
        const { cart: current, ctx } = await session.ensureCart();
        const cart = await getAdapter(ctx.retailer).setQuantity(current.cartId, index, quantity, ctx);
        return { ...text(renderCart(cart)), structuredContent: { cart } };
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
      outputSchema: CartOutput,
    },
    async () => {
      try {
        const { cart } = await session.ensureCart();
        return { ...text(renderCart(cart)), structuredContent: { cart } };
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
      outputSchema: CartLinkOutput,
    },
    async () => {
      try {
        const { cart, ctx } = await session.ensureCart();
        const url = getAdapter(ctx.retailer).handoffUrl(cart.cartId);
        if (!cart.lines.length) {
          return { ...text('Cart is empty — add something before handing it over.'),
                   structuredContent: { cart } };
        }
        return { ...text(renderCart(cart, url)), structuredContent: { cart, handoffUrl: url } };
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
      const ctx = session.getLocation();
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
 * Build a server with the catalog tools — search, cart, handoff link. Nothing
 * here touches an account or spends money.
 *
 * The checkout tools are deliberately NOT reachable from this module. They
 * drive a headed browser and hold an EVM signer, and the binary that wants
 * them imports them itself (see index.ts). Making that a module boundary
 * rather than a `checkout: false` option is the difference between a host
 * that does not call Playwright and a host that cannot: a bundler resolves
 * `await import()` statically, so a flag would keep the dependency out of the
 * running code and leave it in the deployment.
 */
export interface ServerOptions {
  /**
   * State for this shopper. Omit for a process that serves one user; pass
   * `createSessionState()` per connection for one that serves many.
   */
  session?: SessionState;
  name?: string;
  version?: string;
  /**
   * What to tell the model at connect. Defaults to the catalog half, which is
   * all this function registers. The stdio binary passes the full set,
   * because it also registers the checkout tools.
   */
  instructions?: string;
}

export function createSupermercadoServer(opts: ServerOptions = {}): McpServer {
  // `instructions` is shown to the model once at connect. Ten tool descriptions
  // say what each tool does; only this can say what order they go in and where
  // the server stops.
  const server = new McpServer(
    { name: opts.name ?? 'supermercado-mcp', version: opts.version ?? '0.2.0' },
    { instructions: opts.instructions ?? CATALOG_INSTRUCTIONS },
  );

  registerCatalogTools(server, opts.session ?? defaultSession);

  return server;
}
