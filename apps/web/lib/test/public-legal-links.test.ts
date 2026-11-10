import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PUBLIC_LEGAL, SUPPORT_EMAIL } from '@changuito/trust';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the shopper footer keeps /privacidad and links out to the public terms and deletion pages', () => {
  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const footerStart = page.indexOf('<footer className="app-footer"');
  const footerEnd = page.indexOf('</footer>', footerStart);
  const footer = page.slice(footerStart, footerEnd);
  assert.match(footer, /<a className="app-legal" href="\/privacidad">/);
  assert.match(footer, /PUBLIC_LEGAL\.terms/);
  assert.match(footer, /PUBLIC_LEGAL\.deletion/);
  assert.equal(PUBLIC_LEGAL.deletion.en, 'https://www.changuito.me/delete-account');
  assert.equal(PUBLIC_LEGAL.deletion.es, 'https://www.changuito.me/eliminar-cuenta');
  assert.equal(PUBLIC_LEGAL.terms.en, 'https://www.changuito.me/terms');
  assert.equal(PUBLIC_LEGAL.privacy.es, 'https://www.changuito.me/privacidad');
  assert.equal(SUPPORT_EMAIL, 'contact@simonethg.com');
});

test('the in-app privacy page links to the published policy and the deletion page', () => {
  const page = readFileSync(join(root, 'app/privacidad/page.tsx'), 'utf8');
  assert.match(page, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(page, /PUBLIC_LEGAL\.deletion/);
  assert.match(page, /PUBLIC_LEGAL\.privacy/);
  assert.match(page, /href="\/"/);
});
