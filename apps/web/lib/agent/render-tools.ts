import type Anthropic from '@anthropic-ai/sdk';
import type { Cart, Product } from '@changuito/mcp/types';

import type { UiEvent } from '../protocol';

/**
 * Tools the model calls to draw things, which never reach the MCP server.
 *
 * Splitting "what the data is" from "show it" is the whole design. A tool
 * result is data: `search_products` returns twelve items whether the model
 * recommends three or none of them. Which ones to surface is a decision, and
 * a decision has to be a call.
 *
 * The inputs are identifiers only — never a price, never a name. The model
 * picks SKUs; the server looks up what they cost. That is the difference
 * between a grid that is wrong and a grid that cannot be wrong, and it matters
 * most directly above a button that spends money.
 */

/** Filled from `structuredContent` as tools return, so renders can hydrate. */
export interface RenderCache {
  products: Map<string, Product>;
  cart?: Cart;
  handoffUrl?: string;
}

export const emptyCache = (): RenderCache => ({ products: new Map() });

/** Absorb whatever structure a tool result carried. Unknown shapes are ignored. */
export function rememberStructured(cache: RenderCache, structured: unknown): void {
  if (!structured || typeof structured !== 'object') return;
  const s = structured as { products?: Product[]; cart?: Cart; handoffUrl?: string };

  for (const p of s.products ?? []) cache.products.set(p.skuId, p);

  if (s.cart) {
    cache.cart = s.cart;
    // A cart's lines are the freshest prices there are — the store just quoted
    // them — so they win over an older search result for the same SKU.
    for (const line of s.cart.lines) {
      const known = cache.products.get(line.skuId);
      if (known) cache.products.set(line.skuId, { ...known, price: line.unitPrice });
    }
  }
  if (s.handoffUrl) cache.handoffUrl = s.handoffUrl;
}

export const RENDER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'render_products',
    description:
      'Show product cards to the user. Pass only the SKUs you are actually recommending — ' +
      'the UI draws them, so do not also list them in prose. Prices and names come from the ' +
      'last search; you do not supply them.',
    input_schema: {
      type: 'object',
      properties: {
        sku_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'SKU ids from a previous search_products or price_check result.',
          minItems: 1,
        },
        note: {
          type: 'string',
          description: 'One short line above the grid, e.g. "la opción más barata por litro".',
        },
      },
      required: ['sku_ids'],
    },
  },
  {
    name: 'render_cart',
    description:
      'Show the current cart as a card, with the total and the link that opens it in the ' +
      "supermarket's own site. Call get_cart_link first, then this once — the card carries " +
      'the link, and one card per reply is what the user should see. Call it again only if ' +
      'the cart changes afterwards.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const RENDER_TOOL_NAMES = new Set(RENDER_TOOLS.map((t) => t.name));

export function runRenderTool(
  cache: RenderCache,
  use: { id: string; name: string; input: unknown },
  emit: (e: UiEvent) => void,
): Anthropic.ToolResultBlockParam {
  const result = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: use.id,
    content,
    is_error: isError || undefined,
  });

  if (use.name === 'render_products') {
    const ids = ((use.input as { sku_ids?: unknown })?.sku_ids ?? []) as string[];
    const note = (use.input as { note?: string })?.note;

    const items = ids.map((id) => cache.products.get(id)).filter((p): p is Product => Boolean(p));
    const missing = ids.filter((id) => !cache.products.has(id));

    if (!items.length) {
      // Refusing beats rendering a plausible guess: an invented SKU is an
      // invented price.
      return result(
        `None of those SKUs came from a search in this conversation: ${missing.join(', ')}. ` +
          'Call search_products first and use the sku= values it returns.',
        true,
      );
    }

    emit({ t: 'products', items, note });
    return result(
      `Rendered ${items.length} product card(s).` +
        (missing.length ? ` Skipped unknown SKUs: ${missing.join(', ')}.` : ''),
    );
  }

  if (use.name === 'render_cart') {
    if (!cache.cart) {
      return result('No cart yet. Call view_cart or add_to_cart first.', true);
    }
    emit({ t: 'cart', cart: cache.cart, handoffUrl: cache.handoffUrl });
    return result(`Rendered the cart: ${cache.cart.lines.length} line(s), ${cache.cart.total.display}.`);
  }

  return result(`Unknown render tool ${use.name}.`, true);
}
