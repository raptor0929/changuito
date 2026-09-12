/**
 * Record a real checkout, headed, so the deterministic layers can be built
 * against screens that exist rather than screens I imagined.
 *
 * You drive. A browser opens with your saved session, you click through Día's
 * checkout yourself, and this watches: every time the page becomes a different
 * page it captures the PageState, the orderForm, what the classifier decided
 * and what the loop would have done next. Stop at the payment form — there is
 * no reason to place an order to record one.
 *
 *   node dist/record.js                  # start on the cart
 *   node dist/record.js --url <url>      # start somewhere specific
 *   node dist/record.js --minutes 20
 *
 * Output lands in fixtures/recordings/<timestamp>/ and is directly loadable by
 * the classifier tests.
 *
 * WHAT IS WRITTEN: the orderForm is scrubbed before it touches disk — name,
 * email, DNI, phone and street address are replaced with placeholders of the
 * same shape. A fixture is a description of a screen, not a copy of your
 * identity, and these files end up in a repository.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { VtexOrderForm } from './adapters/orderform.js';
import { launch, newContext } from './checkout/browser.js';
import { fetchOrderForm } from './checkout/cart.js';
import { classifyDeterministic } from './checkout/classify/index.js';
import { readPageState, signature, summarize, type PageState } from './checkout/pagestate.js';
import { readSession } from './checkout/session-store.js';
import { scrubOrderForm } from './checkout/scrub.js';
import { planAction } from './checkout/states.js';
import { loadConfig, requirePassphrase } from './config.js';
import { log } from './secure/redact.js';

const argv = process.argv.slice(2);
const opt = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};

const POLL_MS = 1_000;
const MINUTES = Number(opt('minutes', '20'));

const cfg = loadConfig();
const passphrase = requirePassphrase('SESSION_PASSPHRASE');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(opt('out', 'fixtures/recordings')!, stamp);
await mkdir(outDir, { recursive: true });

const stored = await readSession(cfg.sessionVaultPath, passphrase);
if (!stored) {
  console.error('No saved session. Run link_marketplace_account first — a recording of a logged-out checkout is not useful.');
  process.exit(1);
}

const browser = await launch(cfg, { headed: true, slowMoMs: 0 });
const context = await newContext(browser, cfg, stored.state);
const page = await context.newPage();

const startUrl = opt('url') ?? `https://${cfg.host}/checkout/#/cart`;
await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

console.log(`
Recording to ${outDir}

  Drive the checkout yourself in the window that just opened. Every distinct
  screen is captured automatically.

  STOP AT THE PAYMENT FORM. Do not place the order — recording one does not
  need one. Close the window, or press Ctrl-C, when you are done.
`);

interface Capture {
  n: number;
  at: string;
  url: string;
  signature: string;
  verdict: ReturnType<typeof classifyDeterministic>;
  action?: ReturnType<typeof planAction>;
  pageState: PageState;
  orderForm?: VtexOrderForm;
}

const index: Array<Pick<Capture, 'n' | 'at' | 'url'> & { state: string; layer?: string; why?: string; file: string }> = [];
let lastSignature = '';
let n = 0;
let stopping = false;

const finish = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await writeFile(
    resolve(outDir, 'index.json'),
    JSON.stringify({ recordedAt: stamp, host: cfg.host, captures: index }, null, 2),
  );
  console.log(`\n${index.length} screen(s) recorded in ${outDir}`);
  const unknown = index.filter((c) => c.state === 'unknown' || !c.layer);
  if (unknown.length) {
    console.log(
      `${unknown.length} of them were NOT recognised by the deterministic layers — ` +
        'those are the ones worth turning into a modals.ts entry:',
    );
    for (const u of unknown) console.log(`  #${u.n} ${u.url}`);
  } else {
    console.log('Every screen was recognised deterministically. No Jev call would have been needed.');
  }
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void finish());
page.on('close', () => void finish());

const deadline = Date.now() + MINUTES * 60_000;

while (!stopping && Date.now() < deadline) {
  try {
    if (page.isClosed()) break;
    const pageState = await readPageState(page);
    const sig = signature(pageState);
    if (sig !== lastSignature) {
      lastSignature = sig;
      n += 1;

      let orderForm: VtexOrderForm | undefined;
      try {
        orderForm = await fetchOrderForm(page.request, cfg);
      } catch {
        // A screen with no readable orderForm is itself worth recording.
      }

      const verdict = classifyDeterministic({ pageState, orderForm });
      const action = verdict ? planAction(verdict, pageState, { goal: 'payment_form', hasAddress: true }) : undefined;

      const capture: Capture = {
        n,
        at: new Date().toISOString(),
        url: pageState.url,
        signature: sig,
        verdict,
        action,
        pageState,
        orderForm: scrubOrderForm(orderForm),
      };

      const file = `${String(n).padStart(3, '0')}-${verdict?.state ?? 'unrecognised'}.json`;
      await writeFile(resolve(outDir, file), JSON.stringify(capture, null, 2));
      index.push({
        n,
        at: capture.at,
        url: capture.url,
        state: verdict?.state ?? 'unknown',
        layer: verdict?.layer,
        why: verdict?.why,
        file,
      });

      console.log(
        `#${String(n).padStart(2)} ${(verdict?.state ?? 'UNRECOGNISED').padEnd(16)}` +
          `${(verdict?.layer ?? '-').padEnd(11)}${action ? action.kind : '-'}` +
          `${verdict ? `  — ${verdict.why}` : '  — no layer matched; this is a gap'}`,
      );
      if (!verdict) console.log(summarize(pageState).split('\n').map((l) => `     ${l}`).join('\n'));
    }
  } catch (e) {
    // A navigation mid-read throws; that is normal and not worth stopping for.
    log(`[record] skipped a poll: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

await finish();
