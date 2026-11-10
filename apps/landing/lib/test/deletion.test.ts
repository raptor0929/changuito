import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SUPPORT_EMAIL } from '@changuito/trust';

import {
  DELETION_FOOTER_LINKS,
  DELETION_UPDATED,
  LEGAL_PATHS,
  SUPPORT_FOOTER_LINK,
  legalCopy,
} from '../legal.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('account deletion pages exist in both languages and name the support address', () => {
  assert.equal(SUPPORT_EMAIL, 'contact@simonethg.com');
  assert.equal(SUPPORT_FOOTER_LINK.label, SUPPORT_EMAIL);
  assert.equal(SUPPORT_FOOTER_LINK.href, `mailto:${SUPPORT_EMAIL}`);
  assert.deepEqual(
    DELETION_FOOTER_LINKS.map((link) => link.href),
    ['/eliminar-cuenta'],
  );

  for (const lang of ['en', 'es'] as const) {
    const path = LEGAL_PATHS.deletion[lang];
    assert.ok(existsSync(join(root, 'app', path.slice(1), 'page.tsx')), path);
    const copy = legalCopy('deletion', lang);
    assert.equal(copy.updated, DELETION_UPDATED);
    assert.equal(copy.switchHref, LEGAL_PATHS.deletion[lang === 'en' ? 'es' : 'en']);
    const text = copy.sections.flatMap((section) => section.paragraphs).join(' ');
    assert.equal(text.includes(SUPPORT_EMAIL), true);
    assert.equal(text.includes('30'), true);
    assert.match(text, /blockchain|USDC/);
    const ids = copy.sections.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length);
  }

  assert.deepEqual(
    legalCopy('deletion', 'en').sections.map((section) => section.id),
    legalCopy('deletion', 'es').sections.map((section) => section.id),
  );
});

test('the landing footer and sitemap publish the deletion page and the support address', () => {
  const footer = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  assert.match(footer, /DELETION_FOOTER_LINKS/);
  assert.match(footer, /SUPPORT_FOOTER_LINK/);
  const sitemap = readFileSync(join(root, 'app/sitemap.ts'), 'utf8');
  assert.match(sitemap, /LEGAL_PATHS/);
  assert.equal(LEGAL_PATHS.deletion.en, '/delete-account');
  assert.equal(LEGAL_PATHS.deletion.es, '/eliminar-cuenta');
});
