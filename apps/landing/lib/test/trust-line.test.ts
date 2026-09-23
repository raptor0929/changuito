import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const landing = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string): string {
  return readFileSync(join(landing, path), 'utf8');
}

test('the credit line is one sentence, with the year and the mark', () => {
  const trust = source('components/landing/trust-line.tsx');
  assert.match(trust, /© 2026 Changuito® · Hecho en 🇦🇷 por/);
  assert.match(trust, /https:\/\/www\.linkedin\.com\/in\/simonethg\//);
  assert.match(trust, /SimonethG/);
  assert.match(trust, /https:\/\/www\.linkedin\.com\/in\/fabio-laura-yavi\//);
  assert.match(trust, />\s*Fabio\s*</);
  assert.match(trust, /target="_blank"/);
  assert.match(trust, /rel="noopener noreferrer"/);
  assert.equal(/© 2026 Changuito(?!®)/.test(trust), false);
  assert.equal(trust.includes('\u2014'), false);
  assert.equal(trust.includes('\u2013'), false);
});

test('home, whitelist and reportarbug share that line and drop the old copyright', () => {
  const home = source('components/landing/landing-page.tsx');
  const whitelist = source('app/whitelist/page.tsx');
  const bug = source('app/reportarbug/page.tsx');
  const copy = source('lib/copy.ts');

  for (const file of [home, whitelist, bug]) {
    assert.match(file, /<TrustLine/);
    assert.equal(/© 2026 Changuito/.test(file), false);
  }
  assert.equal(copy.includes('© 2026 Changuito'), false);
  assert.equal(copy.includes('copyright'), false);
});
