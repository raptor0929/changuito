import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COPYRIGHT_LINE,
  FOUNDER_SENTENCE,
  FOUNDERS,
  TRUST_LINE,
} from '../../../../packages/trust/src/copy.ts';
import {
  APP_URL,
  BENEFITS,
  BENEFITS_TITLE,
  BOFU,
  DESCRIPTION,
  FAQ,
  FOOTER,
  HERO,
  NO_CHARGE,
  PAYMENTS,
  SITE_URL,
  SOCIAL,
  STEPS,
  STEPS_TITLE,
} from '../copy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the only app handoff is https://app.changuito.me', () => {
  const url = new URL(APP_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'app.changuito.me');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(new URL(SITE_URL).hostname, 'www.changuito.me');
});

test('footer social profiles point at @appchanguito', () => {
  assert.deepEqual(
    SOCIAL.map((link) => ({ href: link.href, label: link.label, ariaLabel: link.ariaLabel })),
    [
      {
        href: 'https://x.com/appchanguito',
        label: 'X',
        ariaLabel: 'Changuito en X',
      },
      {
        href: 'https://instagram.com/appchanguito',
        label: 'Instagram',
        ariaLabel: 'Changuito en Instagram',
      },
    ],
  );
  assert.equal(SOCIAL.filter((link) => link.href === 'https://x.com/appchanguito').length, 1);
  assert.equal(SOCIAL.filter((link) => link.href.includes('twitter.com')).length, 0);
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  assert.equal(page.includes('SOCIAL'), true);
  assert.equal(page.includes('landing-social'), true);
  assert.equal(page.includes('target="_blank"'), true);
  assert.equal(page.includes('noopener noreferrer'), true);
  assert.equal(page.includes('XIcon'), false);
  assert.equal(page.includes('https://x.com/appchanguito'), false);
  assert.equal(page.split('SOCIAL.map').length - 1, 1);
  assert.equal(page.includes('landing-footer-app'), false);
  assert.equal(page.includes('FOOTER.appLabel'), false);
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(css.includes('.footerLabel'), false);
});

test('hero copy matches the locked brief', () => {
  assert.equal(`${HERO.h1Lead} ${HERO.h1Rest}`, 'Pedí el súper inteligente');
  assert.equal(
    HERO.sub,
    'Changuito compara productos, arma el carrito y te deja listo para pagar.',
  );
  assert.equal(HERO.pay, 'Pagá con tarjeta o USDC.');
  assert.equal(HERO.cta, 'Probar Changuito');
  assert.equal('secondary' in HERO, false);
  assert.equal(PAYMENTS.assurance, NO_CHARGE);
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(page.includes('Ver cómo funciona'), false);
  assert.equal(page.includes('textLink'), false);
  assert.equal(css.includes('.textLink'), false);
  assert.equal(page.includes('id="como-funciona"'), true);
  assert.equal(page.includes('/brand/animacion-cargando.gif'), true);
});

test('landing copy stays free of jargon and a refund promise', () => {
  const blob = JSON.stringify({
    HERO,
    STEPS,
    STEPS_TITLE,
    BENEFITS,
    BENEFITS_TITLE,
    PAYMENTS,
    FAQ,
    BOFU,
    FOOTER,
    TRUST_LINE,
    FOUNDER_SENTENCE,
    FOUNDERS,
    SOCIAL,
    DESCRIPTION,
  }).toLowerCase();
  for (const word of [
    'blockchain',
    'wallet',
    'crypto',
    'web3',
    'stellar',
    'escrow',
    'mcp',
    'baloo',
    'devolvemos',
    'no inventados',
  ]) {
    assert.equal(blob.includes(word), false, word);
  }
  const withoutNoCharge = blob.split(NO_CHARGE.toLowerCase()).join('');
  assert.equal(withoutNoCharge.includes('no se completa'), false);
  assert.equal(blob.split(NO_CHARGE.toLowerCase()).length - 1, 2);
  assert.equal(STEPS.length, 4);
  assert.equal(BENEFITS.length, 3);
  assert.deepEqual(
    BENEFITS.map((item) => item.title),
    ['Simple', 'Sin pensar mucho', 'Local'],
  );
  assert.equal(BENEFITS[0].body, 'Armá el súper sin pensar. Changuito empuja el carrito con vos.');
  assert.equal(
    BENEFITS[1].body,
    'Contale para qué ocasión preparás la comida y para cuántas personas, y Changuito se encarga de cada detalle por vos.',
  );
  assert.equal(
    BENEFITS[2].body,
    'Changuito te ayuda a ahorrar comparando precios entre varios supermercados y armándote el carrito como más te convenga.',
  );
  assert.equal(FAQ.length, 4);
  assert.equal(FAQ[2].q, '¿Qué pasa si falla la compra?');
  assert.equal(FAQ[2].a, NO_CHARGE);
  assert.equal(
    STEPS[0].body,
    'En lenguaje natural: la lista, una receta o lo de la juntada. Changuito busca y calcula con IA.',
  );
  assert.equal(
    FAQ[0].a,
    'No. Es un asistente de IA para el súper: le pedís en tu idioma lo que necesitás — una receta, una juntada, la lista de la semana — y Changuito busca, calcula y te arma el carrito.',
  );
});

test('the landing serves the loading GIF and not the éxito pose', () => {
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(page.split('/brand/animacion-cargando.gif').length - 1, 1);
  assert.equal(page.split('Le caen los productos al carrito de Changuito').length - 1, 1);
  const payments = page.slice(
    page.indexOf('data-testid="landing-payments"'),
    page.indexOf('data-testid="landing-faq"'),
  );
  assert.equal(payments.includes('<img'), false);
  assert.equal(payments.includes('payMascot'), false);
  assert.equal(payments.includes('animacion-'), false);
  assert.equal(payments.includes('mascot-'), false);
  assert.equal(css.includes('.payLayout'), false);
  assert.equal(css.includes('.payMascot'), false);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(page.includes('mascot-exito'), false);
  assert.equal(page.includes('mascot-idle.png'), true);
  assert.equal(existsSync(join(root, 'public/brand/animacion-busqueda.gif')), false);
  assert.equal(existsSync(join(root, 'public/brand/mascot-idle.png')), true);
  assert.equal(existsSync(join(root, 'public/brand/mascot-exito.png')), false);
  const served = readFileSync(join(root, 'public/brand/animacion-cargando.gif'));
  const branding = join(root, '../branding');
  const master = readFileSync(join(branding, 'motion/animacion-cargando.gif'));
  assert.equal(createHash('md5').update(served).digest('hex'), '662fec0a1f1102d26f8fd85c06b24c4f');
  assert.equal(createHash('md5').update(master).digest('hex'), '662fec0a1f1102d26f8fd85c06b24c4f');
  assert.equal(served.readUInt16LE(6), 480);
  assert.equal(served.readUInt16LE(8), 360);
  assert.equal(existsSync(join(branding, 'mascot/mascota-exito.png')), false);
  assert.equal(existsSync(join(branding, '_discarded/mascota-exito.png')), true);
  assert.equal(existsSync(join(branding, 'motion/animacion-busqueda.gif')), true);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.mascotMotion\s*\{[^}]*display:\s*none/);
  assert.match(reduced, /\.mascotStill\s*\{[^}]*display:\s*block/);
});

test('source does not reintroduce the refund line or a tiled pattern', () => {
  const textExt = new Set(['.ts', '.tsx', '.css', '.md', '.json']);
  const hits: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'lib') continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!textExt.has(ext)) continue;
      const text = readFileSync(path, 'utf8').toLowerCase();
      if (
        text.includes('devolvemos') ||
        text.includes('no se completa') ||
        text.includes('no inventados') ||
        text.includes('patron-mate-pan') ||
        text.includes('background-repeat')
      ) {
        hits.push(relative(root, path));
      }
    }
  }
  walk(root);
  assert.deepEqual(hits, []);
});

test('founder trust is one shared line, with the mark, and not a second copyright', () => {
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(COPYRIGHT_LINE, '© 2026 Changuito\u00AE');
  assert.equal(FOUNDER_SENTENCE, 'Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal('copyright' in FOOTER, false);

  const home = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const footer = home.slice(home.indexOf('<footer'));
  const legalAt = footer.indexOf('{FOOTER.legal}');
  const trustAt = footer.indexOf('<FounderTrust');
  const navClose = footer.indexOf('</nav>');
  assert.ok(navClose !== -1 && navClose < legalAt);
  assert.ok(legalAt !== -1 && legalAt < trustAt);
  assert.equal(footer.includes('FOOTER.copyright'), false);
  assert.equal(footer.includes('©'), false);
  assert.equal(footer.slice(0, navClose).includes('FounderTrust'), false);
  assert.equal(footer.split('FounderTrust').length - 1, 1);

  const whitelist = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const cardAt = whitelist.indexOf('styles.card');
  const whitelistTrust = whitelist.indexOf('<FounderTrust');
  const mainClose = whitelist.indexOf('</main>');
  assert.ok(cardAt !== -1 && cardAt < whitelistTrust && whitelistTrust < mainClose);
  assert.equal(whitelist.split('FounderTrust').length - 1, 2);

  const bug = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'components/bug-report/bug-report-panel.tsx'), 'utf8');
  const bugCss = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');
  const viewport = readFileSync(join(root, 'components/bug-report/bug-report-viewport.tsx'), 'utf8');
  assert.equal(panel.includes('FounderTrust'), false);
  assert.equal(bug.split('FounderTrust').length - 1, 2);
  assert.match(bugCss, /data-keyboard='open'/);
  assert.match(viewport, /dataset\.keyboard = 'open'/);
  assert.equal(existsSync(join(root, 'components/trust/founder-line.tsx')), false);
});

test('footer social links are at least a 44×44 tap target', () => {
  // The X link is one letter; without a min-width it measured about 32×44.
  const css = readFileSync(new URL('../../components/landing/landing.module.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.socialLink {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /min-width:\s*44px/);
  assert.match(body, /min-height:\s*44px/);
});
