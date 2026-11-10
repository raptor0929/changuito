/**
 * What the shopper can already see, sent back because the next isolate
 * often cannot.
 *
 * The turn store is an in-process map on this Worker, so a message that
 * lands elsewhere starts with an empty transcript. The browser still has
 * the lines they typed and the products on screen. Those come back on the
 * request, and when the server has no transcript yet they are written in
 * as one exchange the model reads and the shopper does not see again.
 *
 * Names and sku ids only. A price in this payload would be a number the
 * browser invented, and the grid above a pay button is filled from the
 * server's own cache.
 */

export interface ShownProduct {
  skuId: string;
  name: string;
}

const SHOWN_CAP = 8;
const SKU = /^[A-Za-z0-9_-]{1,40}$/;

/** The products a request claims are on screen. Drops prices and anything odd. */
export function shownProducts(raw: unknown): ShownProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: ShownProduct[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const skuId = String((item as { skuId?: unknown }).skuId ?? '').trim();
    const name = String((item as { name?: unknown }).name ?? '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!SKU.test(skuId) || !name) continue;
    out.push({ skuId, name });
    if (out.length >= SHOWN_CAP) break;
  }
  return out;
}

/** The last product grid on screen, as the request should send it. */
export function lastShown(blocks: { kind: string; items?: { skuId?: string; name?: string }[] }[]): ShownProduct[] {
  let items: { skuId?: string; name?: string }[] | undefined;
  for (const block of blocks) {
    if (block.kind === 'products' && block.items?.length) items = block.items;
  }
  return shownProducts(items);
}

/**
 * One exchange to prepend when this isolate has no transcript.
 * Null when the browser sent nothing worth remembering.
 */
export function recallPair(input: { prior: string[]; shown: ShownProduct[] }): { user: string; assistant: string } | null {
  const prior = input.prior.map((line) => line.trim()).filter(Boolean).slice(-6);
  const shown = input.shown.slice(0, SHOWN_CAP);
  if (!prior.length && !shown.length) return null;
  const user = prior.length ? prior.join('\n') : 'Seguimos con lo que ya vimos.';
  const lines = [
    'Those lines were already said in this chat. Do not greet again. Do not ask again for a supermarket or a postal code that is already in those lines or on the session banner. If the banner has no postal code and one of the lines has one, call set_location before searching.',
  ];
  if (shown.length) {
    lines.push(
      'These products are already on the shopper screen. If they ask to build the cart, search each name again and add that product with add_to_cart, then get_cart_link. Do not say the conversation was empty.',
    );
    for (const product of shown) lines.push(`- ${product.name} (sku ${product.skuId})`);
  }
  return { user, assistant: lines.join('\n') };
}
