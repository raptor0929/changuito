import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const landing = join(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(landing, '../web');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('landing headers use the idle character and set the name in text', () => {
  const header = source(join(landing, 'components/landing/site-header.tsx'));
  const page = source(join(landing, 'components/landing/landing-page.tsx'));
  const lockup = source(join(landing, 'components/landing/brand-lockup.tsx'));
  const blob = [header, page, lockup].join('\n');

  assert.equal(blob.includes('wordmark'), false);
  assert.equal(blob.includes('lockup-stacked'), false);
  assert.equal(blob.includes('sol-mayo'), false);
  assert.match(lockup, /src="\/brand\/mascot-idle\.png"/);
  assert.match(lockup, />Changuito</);
  assert.equal(header.includes('BrandLockup'), true);
  assert.equal(page.includes('BrandLockup'), true);
});

test('the shopper header uses the idle mascot and the wordmark, not type', () => {
  const shopper = source(join(web, 'app/page.tsx'));

  assert.match(shopper, /src="\/brand\/mascot-idle\.png"/);
  assert.match(shopper, /src="\/brand\/wordmark\.png"/);
  assert.match(shopper, /alt="Changuito"/);
  assert.equal(shopper.includes('>Changuito<'), false);
  assert.equal(shopper.includes('lockup-stacked'), false);
});
