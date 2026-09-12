/**
 * The full flow, stopped one step short of spending anything.
 *
 * It does everything a real purchase does — searches, opens your real session,
 * writes to your real cart, drives the real checkout to the card form — and
 * then prints the exact Vyrion request bodies it *would* have sent, redacted,
 * instead of sending them. No card is created. Nothing is submitted.
 *
 * That "everything except the last step" property is the point: the parts that
 * break are the browser parts, and a dry run exercises all of them. What it
 * cannot tell you is whether Día's gateway accepts the BIN — only a live run
 * answers that.
 *
 *   node dist/dryrun.js --cp 1425 --search "leche descremada" \
 *                       --street "Av. Corrientes" --number 1234
 *   node dist/dryrun.js --skip-cart          # review whatever is in the cart already
 *   node dist/dryrun.js --no-browser         # config, Vyrion and FX checks only
 */
import { getAdapter } from './adapters/registry.js';
import { withSession } from './checkout/browser.js';
import { buildCart, describeCart } from './checkout/cart.js';
import { driveToPayment, isEscalation } from './checkout/purchase.js';
import { describeConfig, loadConfig, requirePassphrase } from './config.js';
import { decideFunding, explainFunding } from './pay/funding.js';
import { getArsPerUsd } from './pay/fx.js';
import { formatUsd, toUsd } from './pay/vyrion.js';
import { redactToString } from './secure/redact.js';
import type { DeliveryAddress, Product } from './types.js';
import { pickBin, toDeliveryAddress, vyrionFrom, type AddressInput } from './tools.js';
import { formatARS } from './util/money.js';

// ---- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};
const all = (name: string): string[] =>
  argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? [argv[i + 1]!] : []));

const CP = opt('cp', '1425')!;
const SEARCHES = all('search').length ? all('search') : ['leche descremada'];
const SKUS = all('sku');
const QTY = Number(opt('qty', '1'));
const SKIP_CART = flag('skip-cart');
const NO_BROWSER = flag('no-browser');

let step = 0;
const head = (title: string): void => {
  step += 1;
  console.log(`\n${'='.repeat(72)}\n${step}. ${title}\n${'='.repeat(72)}`);
};
const say = (...parts: unknown[]): void => console.log('   ' + redactToString(parts.map(String).join(' ')));

function addressFromArgs(): DeliveryAddress | undefined {
  const street = opt('street');
  const number = opt('number');
  if (!street || !number) return undefined;
  const input: AddressInput = {
    street,
    number,
    postal_code: opt('postal-code', CP)!,
    complement: opt('complement'),
    city: opt('city'),
    state: opt('province'),
    phone: opt('phone'),
  };
  return toDeliveryAddress(input);
}

// ---- the run ---------------------------------------------------------------

let problems = 0;
const bad = (what: string, e: unknown): void => {
  problems += 1;
  console.log(`   ✗ ${what}: ${redactToString(e instanceof Error ? e.message : String(e))}`);
};

console.log('DRY RUN — nothing here creates a card, and nothing here pays for anything.\n');

const cfg = loadConfig();

head('Configuration');
console.log(describeConfig(cfg));
const address = addressFromArgs();
say(address ? `Delivery address given: ${address.street} ${address.number}, CP ${address.postalCode}` : 'No address given (--street/--number) — the run will use whatever the account already has.');

head('Vyrion — read-only checks');
let requiredCents: number | undefined;
let binId: string | undefined;
try {
  const client = vyrionFrom(cfg);
  say(`key mode: ${client.isLive ? 'LIVE (sk_live_)' : 'sandbox (sk_test_)'}`);
  const balance = await client.walletBalance();
  say(`settled balance:  ${formatUsd(balance.settled)}`);
  say(`pending deposits: ${formatUsd(balance.pending)}  (never counted towards a purchase)`);
  const bins = await client.bins();
  say(`3DS-capable BINs: ${bins.length ? bins.map((b) => `${b.id}(${b.network})`).join(', ') : 'none'}`);
  binId = pickBin(bins, opt('bin')).id;
  say(`would use BIN:    ${binId}`);
} catch (e) {
  bad('Vyrion', e);
}

head('FX rate');
let arsPerUsd = 0;
try {
  const fx = await getArsPerUsd({ override: cfg.fx.override });
  arsPerUsd = fx.arsPerUsd;
  say(`1 USD = ${formatARS(Math.round(fx.arsPerUsd * 100))} (source: ${fx.source})`);
  say(`buffer: ${Math.round(cfg.fx.buffer * 100)}%`);
} catch (e) {
  bad('FX', e);
}

head(`Search at ${cfg.retailer}, CP ${CP}`);
const picks: Array<{ skuId: string; quantity: number; sellerId: string; name: string }> = [];
try {
  const adapter = getAdapter(cfg.retailer);
  const ctx = await adapter.resolveLocation(CP);
  say(`sc=${ctx.salesChannel} region=${ctx.regionId ?? '-'} sellers=${ctx.sellers.length}`);

  if (SKUS.length) {
    for (const spec of SKUS) {
      const [id, qty] = spec.split(':');
      const p = await adapter.getProduct(id!, ctx);
      if (!p) throw new Error(`SKU ${id} not found`);
      picks.push({ skuId: p.skuId, quantity: Number(qty ?? QTY), sellerId: p.sellerId, name: p.name });
    }
  } else {
    for (const term of SEARCHES) {
      const results: Product[] = await adapter.search(term, ctx, { limit: 5 });
      const hit = results.find((p) => p.available);
      say(`"${term}" -> ${results.length} results${hit ? `, taking ${hit.skuId} ${hit.price.display}` : ', none available'}`);
      if (hit) picks.push({ skuId: hit.skuId, quantity: QTY, sellerId: hit.sellerId, name: hit.name });
    }
  }
  for (const p of picks) say(`  ${p.quantity}× ${p.name.slice(0, 50)} (sku ${p.skuId})`);
} catch (e) {
  bad('search', e);
}

if (NO_BROWSER) {
  console.log('\n--no-browser: stopping before anything touches your account.');
  process.exit(problems ? 1 : 0);
}

head('Your session, your cart, your checkout');
let totalCentavos = 0;
try {
  const passphrase = requirePassphrase('SESSION_PASSPHRASE');

  await withSession(cfg, passphrase, async (run) => {
    say(`signed in as ${run.profile?.email ?? '(unknown)'}${run.profile?.document ? ' — DNI is on the profile' : ' — NO DNI on the profile'}`);

    let orderFormId: string | undefined;
    if (SKIP_CART || picks.length === 0) {
      say(SKIP_CART ? 'skipping the cart write (--skip-cart)' : 'nothing to add; reviewing the existing cart');
    } else {
      // The one genuinely destructive thing a dry run does: it writes to the
      // real cart. Said out loud because it is real.
      say('writing to your REAL cart at the store…');
      const built = await buildCart(run.page.request, cfg, picks, { clearFirst: flag('clear-first') });
      orderFormId = built.orderFormId;
      console.log(describeCart(built).split('\n').map((l) => `   ${l}`).join('\n'));
    }

    say('driving the checkout to the card form (nothing is typed into it)…');
    const review = await driveToPayment(run, cfg, { orderFormId, address });
    console.log(review.summary.split('\n').map((l) => `   ${l}`).join('\n'));
    totalCentavos = review.totalCentavos;

    if (!review.flow.reached) {
      problems += 1;
      say('did NOT reach the card form — a live run would have stopped here and asked you.');
    }
    say(`states visited: ${review.flow.history.map((h) => h.verdict.state).join(' → ')}`);
  });
} catch (e) {
  if (isEscalation(e)) {
    problems += 1;
    console.log(`   ⚠ the loop stopped to ask a question:\n${e.message}`);
    if (e.summary) console.log(e.summary.split('\n').map((l) => `      ${l}`).join('\n'));
    if (e.screenshotPath) console.log(`      screenshot: ${e.screenshotPath}`);
  } else {
    bad('checkout', e);
  }
}

head('What would have been sent to Vyrion — and was not');
if (totalCentavos > 0 && arsPerUsd > 0) {
  const plan = decideFunding({
    arsTotal: totalCentavos,
    arsPerUsd,
    // Real balance is irrelevant to the shape of the request; show the request.
    settledUsdCents: Number.MAX_SAFE_INTEGER,
    buffer: cfg.fx.buffer,
  });
  requiredCents = plan.requiredUsdCents;

  console.log(`   POST /cards\n${indent(JSON.stringify({
    bin_id: binId ?? '<no BIN available>',
    amount: toUsd(requiredCents),
    spending_limit: toUsd(requiredCents),
    allowed_categories: cfg.vyrion.allowedCategories,
    label: 'grocery order',
  }, null, 2))}`);
  console.log(`   GET  /cards/{id}/details        → PAN/CVV, held in memory for the form fill only`);
  console.log(`   GET  /3ds                       → polled for the one-time code`);
  console.log(`   DELETE /cards/{id}              → terminated, residual back to the wallet`);
  console.log('');
  console.log(explainFunding(plan).split('\n').map((l) => `   ${l}`).join('\n'));
} else {
  say('no total to size a card from — nothing to show.');
}

head('Result');
console.log(`   Cart total driven to: ${totalCentavos > 0 ? formatARS(totalCentavos) : '(none)'}`);
console.log(`   Card that would be created: ${requiredCents ? formatUsd(requiredCents) : '(none)'}`);
console.log('   Cards created: 0.  Payments submitted: 0.  Nothing was charged.');
console.log(problems === 0 ? '\n   ✓ dry run clean' : `\n   ✗ ${problems} problem(s) — fix these before a live run`);

process.exit(problems ? 1 : 0);

function indent(s: string): string {
  return s.split('\n').map((l) => `     ${l}`).join('\n');
}
