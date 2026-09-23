import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TRUST_LINE } from '../../../../packages/trust/src/copy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the shopper footer uses the shared trust line once', () => {
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  assert.equal(page.split('FounderTrust').length - 1, 2);
  assert.match(page, /<footer className="app-footer">/);
  assert.equal(page.includes('©'), false);
  assert.match(css, /\.app-footer\s*\{/);
  assert.match(css, /safe-area-inset-bottom/);
});
