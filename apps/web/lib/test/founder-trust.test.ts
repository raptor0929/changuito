import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FOUNDERS, TRUST_LINE } from '../founder-trust-copy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the shopper footer uses the trust line once', () => {
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(TRUST_LINE.includes('\u2014'), false);
  assert.equal(TRUST_LINE.includes('\u2013'), false);
  assert.equal(TRUST_LINE.includes('(R)'), false);
  assert.equal(TRUST_LINE.includes('app.changuito.me'), false);
  assert.deepEqual(
    FOUNDERS.map((person) => ({ name: person.name, href: person.href })),
    [
      { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
      { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
    ],
  );

  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  const ui = readFileSync(join(root, 'components/FounderTrust.tsx'), 'utf8');

  assert.equal(page.split('<FounderTrust').length - 1, 1);
  assert.match(page, /import \{ FounderTrust \}/);
  assert.match(page, /<footer className="app-footer">/);
  assert.equal(page.includes('©'), false);
  assert.equal(page.includes('app.changuito.me'), false);
  assert.match(css, /\.app-footer\s*\{/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /flex-direction:\s*column-reverse/);
  assert.equal(ui.includes('target="_blank"'), true);
  assert.equal(ui.includes('rel="noopener noreferrer"'), true);
  assert.equal(ui.includes('app.changuito.me'), false);
  assert.equal(ui.includes('(R)'), false);
  assert.equal(ui.includes('©'), false);

  const copyAt = ui.indexOf('chg-trust-copy');
  const madeAt = ui.indexOf('chg-trust-made');
  assert.ok(copyAt !== -1 && madeAt !== -1 && copyAt < madeAt);
});
