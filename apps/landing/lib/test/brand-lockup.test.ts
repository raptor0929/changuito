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

test('the home header is the wordmark alone', () => {
  const header = source(join(landing, 'components/landing/site-header.tsx'));
  const page = source(join(landing, 'components/landing/landing-page.tsx'));
  const lockup = source(join(landing, 'components/landing/brand-lockup.tsx'));

  assert.match(header, /<BrandLockup variant="wordmark" \/>/);
  assert.equal(header.includes('mascot'), false);
  assert.equal(header.includes('isotipo'), false);
  assert.equal(header.includes('>Changuito<'), false);

  const wordmark = lockup.slice(lockup.indexOf('function Wordmark'), lockup.indexOf('function CharacterMark'));
  assert.match(wordmark, /src="\/brand\/wordmark\.png"/);
  assert.match(wordmark, /alt="Changuito"/);
  assert.equal(wordmark.includes('mascot'), false);
  assert.equal(wordmark.includes('>Changuito<'), false);
  assert.equal(wordmark.includes('isotipo'), false);

  const character = lockup.slice(lockup.indexOf('function CharacterMark'));
  assert.match(character, /src="\/brand\/mascot-idle\.png"/);
  assert.match(character, />Changuito</);

  assert.match(page, /<BrandLockup className=\{styles\.bofuBrand\} \/>/);
  assert.match(page, /<BrandLockup className=\{styles\.footerBrand\} \/>/);
  assert.equal(page.includes('variant="wordmark"'), false);
  assert.equal(page.includes('/brand/animacion-cargando.gif'), true);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(header.includes('BrandLockup'), true);
  assert.equal(page.includes('BrandLockup'), true);
});

test('the shopper header uses the idle mascot and the wordmark, not type', () => {
  const shopper = source(join(web, 'app/page.tsx'));

  assert.match(shopper, /src="\/brand\/mascot-idle\.png"/);
  assert.match(shopper, /src="\/brand\/wordmark\.png"/);
  assert.equal(shopper.includes('lockup-stacked'), false);

  // The h1 is named by text a screen reader and a crawler can read, and the
  // only place that text lives is visually hidden: what shows is the image.
  const h1 = shopper.slice(shopper.indexOf('<h1'), shopper.indexOf('</h1>'));
  assert.match(h1, /<span className="sr-only">Changuito<\/span>/);
  assert.match(h1, /className="brand-wordmark"[\s\S]*alt=""/);
  assert.equal(shopper.replace('<span className="sr-only">Changuito</span>', '').includes('>Changuito<'), false);
});
