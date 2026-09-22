import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_URL,
  BENEFITS,
  BENEFITS_TITLE,
  BOFU,
  FAQ,
  HERO,
  PAYMENTS,
  STEPS,
  STEPS_TITLE,
} from '../landing.ts';

test('the only app handoff is https://app.changuito.me', () => {
  const url = new URL(APP_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'app.changuito.me');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
});

test('hero copy matches the locked brief', () => {
  assert.equal(`${HERO.h1Lead} ${HERO.h1Rest}`, 'Pedí el súper inteligente');
  assert.equal(
    HERO.sub,
    'Changuito compara productos, arma el carrito y te deja listo para pagar.',
  );
  assert.equal(HERO.pay, 'Pagá con tarjeta o USDC.');
  assert.equal(HERO.cta, 'Probar Changuito');
  assert.equal(HERO.refund, 'Si la compra no se completa, te devolvemos el pago.');
});

test('landing copy stays free of product jargon and delivery framing', () => {
  const blob = JSON.stringify({
    HERO,
    STEPS,
    STEPS_TITLE,
    BENEFITS,
    BENEFITS_TITLE,
    PAYMENTS,
    FAQ,
    BOFU,
  }).toLowerCase();
  for (const word of [
    'blockchain',
    'wallet',
    'crypto',
    'web3',
    'stellar',
    'escrow',
    'mcp',
    'delivery',
    'baloo',
  ]) {
    assert.equal(blob.includes(word), false, word);
  }
  assert.equal(STEPS.length, 4);
  assert.equal(BENEFITS.length, 3);
  assert.equal(FAQ.length, 4);
});
