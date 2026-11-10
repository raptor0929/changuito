import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { manualCheckoutFlow, memberFlow } from '../config.ts';
import { escrowCopy } from '../checkout/copy.ts';
import { announcedPhase, flowCopy, flowLabels, flowRailIndex, flowScreen, viewerBody } from '../checkout/flow.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const token = 'a'.repeat(48);

describe('manual checkout flow', () => {
  it('reads an unknown config as viewer and ignores it for a non-member', () => {
    assert.equal(manualCheckoutFlow({}), 'viewer');
    assert.equal(manualCheckoutFlow({ manual_checkout_flow: 'sideways' }), 'viewer');
    assert.equal(manualCheckoutFlow({ manual_checkout_flow: true }), 'viewer');
    assert.equal(manualCheckoutFlow({ manual_checkout_flow: 'guided' }), 'guided');
    assert.equal(manualCheckoutFlow({ manual_checkout_flow: 'headless' }), 'headless');
    assert.equal(memberFlow(false, { manual_checkout_flow: 'headless' }), undefined);
    assert.equal(memberFlow(true, {}), 'viewer');
  });

  it('does not return a viewer url for a headless job', () => {
    const body = viewerBody('headless', 'all', {
      ticket: token, cardToken: token, jobId: 'b'.repeat(32), expiresAt: 1,
    }, 'https://sandbox.example');
    assert.ok(body);
    assert.equal('viewerUrl' in body, false);
    assert.equal('ticket' in body, false);
    assert.match(String(body.formUrl), /part=form$/);
  });

  it('names the rail and the phase in one language, in Spanish and English', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const flow of ['guided', 'headless'] as const) {
        const labels = flowLabels(lang, flow);
        assert.equal(labels.length, 5);
        for (const label of labels) assert.equal(label.includes(' / '), false);
      }
      const words = flowCopy(lang);
      for (const line of [words.progressTitle, words.cardTitle, words.paying, words.verification, words.formFrame]) {
        assert.equal(line.includes(' / '), false);
      }
      assert.equal(words.verification.includes('CHK'), false);
      assert.equal(escrowCopy(lang).phases.payment.includes(' / '), false);
    }
    assert.notEqual(flowCopy('es').paying, flowCopy('en').paying);
    assert.equal(announcedPhase('shop', 'shop'), 'shop');
    assert.equal(announcedPhase('shop', 'payment'), 'payment');

    const preparing = { phase: 'shop', manual: { preparation: 'preparing', purchase: 'not_started' } };
    const ready = { phase: 'payment', manual: { preparation: 'ready', purchase: 'not_started' } };
    assert.equal(flowScreen('guided', preparing, false), 'progress');
    assert.equal(flowScreen('guided', ready, false), 'card');
    assert.equal(flowScreen('guided', ready, true), 'browser');
    assert.equal(flowScreen('headless', ready, true), 'paying');
    assert.equal(flowScreen('headless', { phase: 'payment', manual: { preparation: 'ready', purchase: 'verification_required' } }, true), 'verification');
    assert.equal(flowRailIndex('login', 'progress'), 0);
    assert.equal(flowRailIndex('review', 'progress'), 1);
    assert.equal(flowRailIndex('shopping', 'progress'), 2);
    assert.equal(flowRailIndex('shopping', 'card'), 3);
    assert.equal(flowRailIndex('shopping', 'browser'), 4);
    assert.equal(flowRailIndex('shopping', 'paying'), 4);
  });
});

describe('checkout dialog accessibility', () => {
  const html = readFileSync(join(root, 'services/sandbox/viewer/index.html'), 'utf8');
  const css = readFileSync(join(root, 'apps/web/app/globals.css'), 'utf8');
  const modal = readFileSync(join(root, 'apps/web/components/CheckoutModal.tsx'), 'utf8');
  const guided = readFileSync(join(root, 'apps/web/components/GuidedCheckout.tsx'), 'utf8');

  it('labels every card field, describes its error, and keeps a 44px control at 390 and 1440', () => {
    for (const id of ['pan', 'holder', 'month', 'year', 'cvv']) {
      assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby="${id}-error"`));
      assert.match(html, new RegExp(`id="lbl-${id}"`));
    }
    assert.match(html, /autocomplete="cc-number"/);
    assert.match(html, /autocomplete="cc-name"/);
    assert.match(html, /autocomplete="cc-exp-month"/);
    assert.match(html, /autocomplete="cc-exp-year"/);
    assert.match(html, /autocomplete="cc-csc"/);
    assert.match(html, /inputmode="numeric"/);
    assert.match(html, /min-height:44px/);
    assert.match(html, /color:#7a2e12/);
    assert.match(html, /:focus-visible/);
    // 1440 stays one row. 390 is under 520, so the code wraps under month and year.
    assert.match(html, /grid-template-columns:minmax\(0,1\.4fr\) minmax\(0,\.8fr\) minmax\(0,1fr\)/);
    assert.match(html, /@media\(max-width:520px\)\{[\s\S]*grid-column:1 \/ -1/);
  });

  it('keeps the rail an ordered list, announces a phase politely, and leaves the timer quiet', () => {
    assert.match(modal, /<ol className="ck-rail">/);
    assert.match(modal, /aria-current=\{i === railAt \? 'step' : undefined\}/);
    assert.match(guided, /role="status" aria-live="polite"/);
    assert.match(guided, /aria-live="off"/);
    assert.match(guided, /aria-hidden="true"/);
    assert.match(css, /\.ck-rail \{[\s\S]*flex-wrap: wrap/);
    assert.match(css, /\.ck-input \{[\s\S]*min-height: 44px/);
    assert.match(css, /--warn-ink/);
  });
});
