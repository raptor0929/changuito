/**
 * End-to-end smoke test against the real stores.
 *
 * Read-only by default: location -> search -> price_check (simulation) exercises
 * the exact {id, quantity, seller} contract that add_to_cart uses, without
 * creating state on anyone's store. Pass --write to also create an anonymous
 * cart, add the items and print the handoff URL.
 *
 *   node dist/smoke.js               # safe, creates nothing
 *   node dist/smoke.js --write       # creates a real anonymous cart
 *   node dist/smoke.js --write jumbo # one store only
 */
import { getAdapter, listRetailers } from './adapters/registry.js';

const WRITE = process.argv.includes('--write');
const POSTAL = process.env.SMOKE_POSTAL_CODE ?? '1425';
const QUERY = process.env.SMOKE_QUERY ?? 'leche descremada';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const stores = listRetailers().filter((s) => !only.length || only.includes(s.id));

let failures = 0;

for (const store of stores) {
  console.log(`\n=== ${store.name} (${store.host}) ===`);
  try {
    const adapter = getAdapter(store.id);

    const ctx = await adapter.resolveLocation(POSTAL);
    console.log(
      `  location   sc=${ctx.salesChannel} region=${ctx.regionId ?? '-'} ` +
        `sellers=${ctx.sellers.length}${ctx.degraded ? ' (degraded)' : ''}`,
    );
    if (ctx.degraded && ctx.note) console.log(`             note: ${ctx.note}`);

    const products = await adapter.search(QUERY, ctx, { limit: 5 });
    console.log(`  search     "${QUERY}" -> ${products.length} results`);
    for (const p of products.slice(0, 3)) {
      console.log(`             ${p.skuId.padEnd(10)} ${p.price.display.padStart(10)}  ${p.name.slice(0, 48)}`);
    }

    const picks = products.filter((p) => p.available).slice(0, 2);
    if (!picks.length) throw new Error('no available products to price-check');
    const items = picks.map((p) => ({ skuId: p.skuId, quantity: 1, sellerId: p.sellerId, name: p.name }));

    const quote = await adapter.priceCheck(items, ctx);
    console.log(`  simulate   ${quote.lines.length} line(s), total ${quote.total.display}`);
    for (const l of quote.lines) {
      console.log(`             [${l.index}] ${l.lineTotal.display.padStart(10)}  ${l.available ? 'available' : 'UNAVAILABLE'}  ${l.name.slice(0, 40)}`);
    }

    // Cross-check: does the simulated price match what search advertised?
    // This is the unit-normalization bug detector (centavos vs pesos).
    for (const [i, l] of quote.lines.entries()) {
      const expected = picks[i]!.price.centavos;
      if (l.available && Math.abs(l.lineTotal.centavos - expected) > expected * 0.35) {
        console.log(
          `  ⚠️  price mismatch on ${picks[i]!.skuId}: search said ${picks[i]!.price.display}, ` +
            `simulation says ${l.lineTotal.display} — check unit normalization or promotions`,
        );
      }
    }

    if (WRITE) {
      const empty = await adapter.createCart(ctx);
      const cart = await adapter.addItems(empty.cartId, items, ctx);
      console.log(`  cart       ${cart.cartId} -> ${cart.lines.length} line(s), total ${cart.total.display}`);
      console.log(`  handoff    ${adapter.handoffUrl(cart.cartId)}`);
    }

    console.log(`  ✅ ${store.id} OK`);
  } catch (e) {
    failures++;
    console.log(`  ❌ ${store.id} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(
  `\n${stores.length - failures}/${stores.length} stores passed` +
    (WRITE ? ' (write mode: real carts were created)' : ' (read-only: nothing was created)'),
);
process.exit(failures ? 1 : 0);
