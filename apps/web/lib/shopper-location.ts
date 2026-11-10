/**
 * Supermarket and postal code the shopper already gave, before the model asks.
 *
 * The prompt tells the model to ask whenever the session banner says nothing
 * is set. On a Worker the next message can land where that banner is still
 * empty — another isolate, a turn store that did not keep the transcript —
 * so the model greets again and asks for both, including after the shopper
 * has typed them. The browser still has those lines. They come back as
 * `prior`, and a postal code plus a store (the one already chosen, otherwise
 * Día) is set through the MCP server's own `set_location` before the model
 * runs. A code they type later replaces the one on the session, including a
 * code that came from the profile. The store stays until they name another.
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

/** Same shape `set_location` accepts: 1425, C1425 or C1425DKE. */
function normalizePostal(raw: string): string | null {
  const code = raw.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]?\d{4}([A-Z]{3})?$/.test(code) ? code : null;
}

function postalFrom(text: string): string | null {
  const trimmed = text.trim();
  const bare = trimmed.replace(/^[.\s,;:]+|[.\s,;:!?]+$/g, '');
  const whole = normalizePostal(bare.replace(/^(?:cp|cpa)\s*/i, ''));
  if (whole && bare.length <= 16) return whole;

  const labeled = /\b(?:cp|cpa|c[oó]digo(?:\s+postal)?)\s*:?\s*([A-Za-z]?\s*\d{4}(?:\s*[A-Za-z]{3})?)\b/i.exec(
    trimmed,
  );
  if (labeled) {
    const code = normalizePostal(labeled[1]!);
    if (code) return code;
  }

  // A short reply ("es 1181", "1181 día"). A longer grocery request can
  // contain four digits that are not a postal code, and a price is $1181.
  if (trimmed.length > 40) return null;
  const loose = /(?:^|[^\d$])([A-Za-z]?\d{4}(?:[A-Za-z]{3})?)(?!\d)/i.exec(trimmed);
  return loose ? normalizePostal(loose[1]!) : null;
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

function knownRetailer(id: string | undefined): ShopperPlace['retailer'] | undefined {
  return RETAILERS.some((r) => r.id === id) ? (id as ShopperPlace['retailer']) : undefined;
}

/**
 * The location to set from the shopper's own lines.
 *
 * A named store wins. A postal code on its own keeps the store already on
 * the session (the profile's Día, usually) and replaces the code. Nothing
 * to do when that pair is already set.
 */
export function placeToSet(
  current: { retailer?: string; postalCode?: string } | undefined,
  texts: string[],
): ShopperPlace | null {
  const place = shopperPlace(texts);
  if (!place) return null;
  const retailer = place.namedStore ? place.retailer : (knownRetailer(current?.retailer) ?? 'dia');
  const sameCode = current?.postalCode?.toUpperCase().replace(/\s+/g, '') === place.postalCode;
  if (current?.retailer === retailer && sameCode) return null;
  return { retailer, postalCode: place.postalCode };
}

/**
 * Sets the session location from the shopper's own lines.
 * A store that will not resolve the code leaves the session as it was.
 */
export async function applyShopperPlace(session: ToolSession, texts: string[]): Promise<boolean> {
  const current = session.state.getLocation() as { retailer?: string; postalCode?: string } | undefined;
  const place = placeToSet(current, texts);
  if (!place) return false;
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
