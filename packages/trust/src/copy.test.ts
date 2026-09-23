import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BRAND_MARK,
  COPYRIGHT_LINE,
  COPYRIGHT_YEAR,
  FOUNDER_SENTENCE,
  FOUNDERS,
  NEW_TAB_HINT,
  TRUST_LINE,
  TRUST_SEPARATOR,
} from './copy.ts';

const root = dirname(fileURLToPath(import.meta.url));

test('the trust line is the 2026 lockup with a real registered mark', () => {
  assert.equal(COPYRIGHT_YEAR, 2026);
  assert.equal(BRAND_MARK, 'Changuito\u00AE');
  assert.equal(COPYRIGHT_LINE, '© 2026 Changuito\u00AE');
  assert.equal(FOUNDER_SENTENCE, 'Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(TRUST_SEPARATOR, ' \u00B7 ');
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(TRUST_LINE.includes('\u2014'), false);
  assert.equal(TRUST_LINE.includes('\u2013'), false);
  assert.equal(TRUST_LINE.includes('(R)'), false);
  assert.equal(TRUST_LINE.split('\u00AE').length - 1, 1);
  assert.equal(NEW_TAB_HINT, 'se abre en una pestaña nueva');
  assert.deepEqual(
    FOUNDERS.map((person) => ({ name: person.name, href: person.href })),
    [
      { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
      { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
    ],
  );
});

test('the shared component prints the mark once and links the names', () => {
  const ui = readFileSync(join(root, 'founder-trust.tsx'), 'utf8');
  assert.equal(ui.includes('COPYRIGHT_LINE'), true);
  assert.equal(ui.includes('FOUNDER_PREFIX'), true);
  assert.equal(ui.includes('FOUNDER_JOIN'), true);
  assert.equal(ui.includes('FOUNDER_END'), true);
  assert.equal(ui.includes('TRUST_SEPARATOR'), true);
  assert.equal(ui.includes('NEW_TAB_HINT'), true);
  assert.equal(ui.includes('target="_blank"'), true);
  assert.equal(ui.includes('rel="noopener noreferrer"'), true);
  assert.equal(ui.includes('aria-label'), false);
  assert.equal(ui.includes('(R)'), false);
  assert.equal(ui.includes('©'), false);
  assert.equal(ui.includes('Simoneth Gomez'), false);
  assert.equal(ui.includes('Fabio Laura'), false);
  assert.equal(ui.split('COPYRIGHT_LINE').length - 1, 2);
  const copyAt = ui.indexOf('chg-trust-copy');
  const madeAt = ui.indexOf('chg-trust-made');
  assert.ok(copyAt !== -1 && madeAt !== -1 && copyAt < madeAt);
  assert.equal(ui.includes('flex-direction:column-reverse'), true);
});
