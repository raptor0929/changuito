import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('hero copy matches the locked brief', () => {
  assert.equal(`${HERO.h1Lead} ${HERO.h1Rest}`, 'Pedí el súper inteligente');
  assert.equal(
    HERO.sub,
    'Changuito compara productos, arma el carrito y te deja listo para pagar.',
  );
  assert.equal(HERO.pay, 'Pagá con tarjeta o USDC.');
  assert.equal(HERO.cta, 'Probar Changuito');
  assert.equal(PAYMENTS.assurance, NO_CHARGE);
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

test('the landing serves búsqueda ida-vuelta and not the éxito pose', () => {
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  assert.equal(page.includes('/brand/animacion-busqueda.gif'), true);
  assert.equal(page.includes('mascot-exito'), false);
  assert.equal(page.includes('animacion-cargando'), false);
  assert.equal(page.includes('mascot-idle.png'), true);
  assert.equal(existsSync(join(root, 'public/brand/animacion-busqueda.gif')), true);
  assert.equal(existsSync(join(root, 'public/brand/mascot-idle.png')), true);
  assert.equal(existsSync(join(root, 'public/brand/mascot-exito.png')), false);
  assert.equal(existsSync(join(root, 'public/brand/animacion-cargando.gif')), false);
  const branding = join(root, '../branding');
  assert.equal(existsSync(join(branding, 'mascot/mascota-exito.png')), false);
  assert.equal(existsSync(join(branding, '_discarded/mascota-exito.png')), true);
  assert.equal(existsSync(join(branding, 'motion/animacion-busqueda.gif')), true);
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
