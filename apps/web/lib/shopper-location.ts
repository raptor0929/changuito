/**
 * Supermarket and postal code the shopper already gave, before the model asks.
 *
 * The prompt tells the model to ask whenever the session banner says nothing
 * is set. On a Worker the next message can land where that banner is still
 * empty — another isolate, a turn store that did not keep the transcript —
 * so the model greets again and asks for both, including after the shopper
 * has typed them. The browser still has those lines. They come back as
 * `prior`, and a postal code plus a store (Día when they named none) is set
 * through the MCP server's own `set_location` before the model runs.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const RETAILERS: { id: 'dia' | 'jumbo' | 'disco' | 'carrefour'; names: string[] }[] = [
  { id: 'dia', names: ['dia', 'día'] },
  { id: 'jumbo', names: ['jumbo'] },
  { id: 'disco', names: ['disco'] },
  { id: 'carrefour', names: ['carrefour'] },
];

const PRIOR_CAP = 6;
const PRIOR_CHARS = 500;

export interface ShopperPlace {
  retailer: 'dia' | 'jumbo' | 'disco' | 'carrefour';
  postalCode: string;
}

function postalFrom(text: string): string | null {
  const trimmed = text.trim();
  const only = /^(?:cp\s*)?(\d{4})$/i.exec(trimmed);
  if (only) return only[1]!;
  const named = /\b(?:cp|cpa|c[oó]digo(?:\s+postal)?)\s*:?\s*(\d{4})\b/i.exec(trimmed);
  return named ? named[1]! : null;
}

function retailerFrom(text: string): ShopperPlace['retailer'] | null {
  const trimmed = text.trim().toLowerCase();
  for (const retailer of RETAILERS) {
    if (retailer.names.includes(trimmed)) return retailer.id;
  }
  if (trimmed.length > 80) return null;
  for (const retailer of RETAILERS) {
    for (const name of retailer.names) {
      const pattern = new RegExp(`(?:^|\\s)${name}(?:\\s|$)`, 'i');
      if (pattern.test(trimmed)) return retailer.id;
    }
  }
  return null;
}

/** Last postal code and last named store. Día only when the session is still empty. */
export function shopperPlace(texts: string[]): (ShopperPlace & { namedStore: boolean }) | null {
  let postalCode: string | null = null;
  let retailer: ShopperPlace['retailer'] | null = null;
  for (const text of texts) {
    const postal = postalFrom(text);
    if (postal) postalCode = postal;
    const named = retailerFrom(text);
    if (named) retailer = named;
  }
  if (!postalCode) return null;
  return { retailer: retailer ?? 'dia', postalCode, namedStore: retailer !== null };
}

/** The prior lines a request may carry. Drops anything that is not short text. */
export function priorLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || text.length > PRIOR_CHARS) continue;
    out.push(text);
    if (out.length >= PRIOR_CAP) break;
  }
  return out;
}

type ToolSession = {
  client: Client;
  state: { getLocation(): unknown };
};

/**
 * Sets the session location from the shopper's own lines, when none is set.
 * A store that will not resolve the code leaves the session as it was.
 */
export async function applyShopperPlace(session: ToolSession, texts: string[]): Promise<boolean> {
  const place = shopperPlace(texts);
  if (!place) return false;
  const current = session.state.getLocation() as { retailer?: string; postalCode?: string } | undefined;
  // A postal code with no store fills an empty session as Día. It does not
  // overwrite a store already chosen, including one that came from the profile.
  if (current && !place.namedStore) return false;
  if (current?.retailer === place.retailer && current.postalCode === place.postalCode) return false;
  try {
    const res = await session.client.callTool(
      { name: 'set_location', arguments: { retailer: place.retailer, postal_code: place.postalCode } },
      undefined,
      { timeout: 20_000 },
    );
    return res.isError !== true && Boolean(session.state.getLocation());
  } catch (err) {
    console.warn('[chat] shopper location', err instanceof Error ? err.name : 'failed');
    return false;
  }
}
