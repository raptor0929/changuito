import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SOCIAL } from '../social.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('shopper footer social profiles match the landing accounts', () => {
  assert.deepEqual(
    SOCIAL.map((link) => ({ id: link.id, href: link.href, ariaLabel: link.ariaLabel })),
    [
      {
        id: 'instagram',
        href: 'https://instagram.com/appchanguito',
        ariaLabel: 'Changuito en Instagram',
      },
      {
        id: 'x',
        href: 'https://x.com/appchanguito',
        ariaLabel: 'Changuito en X',
      },
    ],
  );
  assert.equal(SOCIAL.filter((link) => link.href.includes('twitter.com')).length, 0);
  for (const link of SOCIAL) {
    assert.equal(link.ariaLabel.includes('\u2014'), false);
    assert.equal(link.ariaLabel.includes('\u2013'), false);
    assert.equal(link.href.includes('\u2014'), false);
    assert.equal(link.href.includes('\u2013'), false);
  }

  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const footerStart = page.indexOf('<footer className="app-footer">');
  const footerEnd = page.indexOf('</footer>', footerStart);
  const footer = page.slice(footerStart, footerEnd);
  assert.equal(footer.split('<FounderTrust').length - 1, 1);
  assert.equal(footer.split('<FooterSocial').length - 1, 1);
  assert.ok(footer.indexOf('<FounderTrust') < footer.indexOf('<FooterSocial'));
  assert.equal(page.includes('https://x.com/appchanguito'), false);
  assert.equal(page.includes('instagram.com'), false);

  const ui = readFileSync(join(root, 'components/FooterSocial.tsx'), 'utf8');
  assert.equal(ui.includes('target="_blank"'), true);
  assert.equal(ui.includes('rel="noopener noreferrer"'), true);
  assert.equal(ui.includes('aria-label={`${link.ariaLabel}'), true);
  assert.equal(ui.includes('Redes de Changuito'), true);
  assert.equal(ui.includes('data-testid="app-social"'), true);
  assert.equal(ui.includes('\u2014'), false);
  assert.equal(ui.includes('\u2013'), false);

  const icons = readFileSync(join(root, 'components/icons.tsx'), 'utf8');
  assert.equal(icons.includes('export function InstagramIcon'), true);
  assert.equal(icons.includes('export function XIcon'), true);
  assert.equal(icons.includes('aria-hidden'), true);

  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  assert.match(css, /\.app-social-link\s*\{[^}]*width:\s*44px;/s);
  assert.match(css, /\.app-social-link\s*\{[^}]*height:\s*44px;/s);
  assert.match(css, /\.app-social-link:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--chg-espresso\)/s);
  assert.match(css, /@container app-footer \(max-width: 36rem\)/);

  const bug = readFileSync(join(root, 'components/ReportBug.tsx'), 'utf8');
  assert.equal(bug.includes('Reportar un bug'), true);
  assert.equal(bug.includes('https://www.changuito.me/reportarbug'), true);

  const trust = readFileSync(join(root, 'components/FounderTrust.tsx'), 'utf8');
  assert.equal(trust.includes('simoneth.href'), true);
  assert.equal(trust.includes('fabio.href'), true);
  assert.equal(trust.includes('app-social'), false);
});
