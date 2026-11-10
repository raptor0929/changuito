import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LEGAL_FOOTER_LINKS, LEGAL_PATHS, LEGAL_UPDATED, legalCopy } from '../legal.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('every legal route exists in both languages and links to its pair', () => {
  for (const doc of ['terms', 'privacy'] as const) {
    for (const lang of ['en', 'es'] as const) {
      const path = LEGAL_PATHS[doc][lang];
      assert.ok(existsSync(join(root, 'app', path.slice(1), 'page.tsx')), path);
      const copy = legalCopy(doc, lang);
      assert.equal(copy.switchHref, LEGAL_PATHS[doc][lang === 'en' ? 'es' : 'en']);
      assert.ok(copy.sections.length >= 8);
      const ids = copy.sections.map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
  assert.equal(LEGAL_UPDATED, '2026-10-25');
});

test('both languages carry the same sections in the same order', () => {
  for (const doc of ['terms', 'privacy'] as const) {
    assert.deepEqual(
      legalCopy(doc, 'en').sections.map((s) => s.id),
      legalCopy(doc, 'es').sections.map((s) => s.id),
    );
  }
});

test('terms state the beta, test funds, fee, keys, no advice and Argentine law', () => {
  const text = legalCopy('terms', 'en').sections.flatMap((s) => s.paragraphs).join(' ');
  for (const needle of ['devnet', 'test USDC', 'no monetary value', 'escrow', '20% of the savings', '0%', 'seed phrase', 'financial', 'Argentine Republic', 'can change']) {
    assert.ok(text.includes(needle), needle);
  }
});

test('the landing footer links to both legal pages', () => {
  const footer = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  assert.match(footer, /LEGAL_FOOTER_LINKS/);
  assert.deepEqual(LEGAL_FOOTER_LINKS.map((l) => l.href), ['/terminos', '/privacidad']);
});

test('legal page colors clear WCAG AA in light and dark', () => {
  assert.ok(ratio('#2a1a14', '#fafaf7') >= 4.5);
  assert.ok(ratio('#5c534c', '#fafaf7') >= 4.5);
  assert.ok(ratio('#f3ece4', '#1c1310') >= 4.5);
  assert.ok(ratio('#cbbfb3', '#1c1310') >= 4.5);
  assert.ok(ratio('#f4b942', '#1c1310') >= 4.5);
  assert.ok(ratio('#cbbfb3', '#2a1a14') >= 4.5);
  assert.ok(ratio('#f4b942', '#2a1a14') >= 4.5);
  assert.ok(ratio('#2a1a14', '#f4b942') >= 4.5);
});
