import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COPYRIGHT_LINE } from '../founder-trust-copy.ts';
import { privacyCopy } from '../privacy-copy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the shopper footer is the mark, the privacy link and the language switch', () => {
  assert.equal(COPYRIGHT_LINE, '© 2026 Changuito\u00AE');
  assert.equal(COPYRIGHT_LINE.includes('Hecho en'), false);

  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const footerStart = page.indexOf('className="app-footer"');
  const footerEnd = page.indexOf('</footer>', footerStart);
  const footer = page.slice(footerStart, footerEnd);
  assert.equal(footer.split('<LangToggle').length - 1, 1);
  assert.equal(footer.split('COPYRIGHT_LINE').length - 1, 1);
  assert.match(footer, /href="\/privacidad"/);
  assert.match(footer, /es: 'Privacidad'/);
  assert.match(footer, /en: 'Privacy'/);
  assert.equal(footer.includes('FooterPoweredBy'), false);
  assert.equal(footer.includes('FooterSocial'), false);
  assert.equal(footer.includes('FounderTrust'), false);
  assert.equal(footer.includes('Hecho en'), false);
  assert.equal(footer.includes('SimonethG'), false);
  assert.equal(existsSync(join(root, 'components/FooterPoweredBy.tsx')), false);
  assert.equal(existsSync(join(root, 'components/FooterSocial.tsx')), false);

  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  assert.match(css, /\.app-legal\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.app-legal:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--chg-espresso\)/s);
  assert.match(css, /safe-area-inset-bottom/);
  assert.equal(css.includes('.app-powered'), false);
  assert.equal(css.includes('.app-social'), false);

  assert.equal(existsSync(join(root, 'app/privacidad/page.tsx')), true);
  const privacy = readFileSync(join(root, 'app/privacidad/page.tsx'), 'utf8');
  assert.match(privacy, /href="\/"/);
  assert.equal(privacyCopy('es').title, 'Privacidad');
  assert.equal(privacyCopy('en').title, 'Privacy');
  assert.deepEqual(
    privacyCopy('es').sections.map((section) => section.id),
    privacyCopy('en').sections.map((section) => section.id),
  );
  assert.equal(privacy.includes('sol.changuito.me'), false);
  assert.equal(privacy.includes('Privy'), false);
});
