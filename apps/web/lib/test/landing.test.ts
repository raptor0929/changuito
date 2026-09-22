import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_URL,
  BENEFITS,
  BENEFITS_TITLE,
  BOFU,
  FAQ,
  FINE_PRINT,
  HERO,
  NO_CHARGE,
  PAYMENTS,
  STEPS,
  STEPS_TITLE,
} from '../landing.ts';

const COPY = {
  HERO,
  STEPS,
  STEPS_TITLE,
  BENEFITS,
  BENEFITS_TITLE,
  PAYMENTS,
  FAQ,
  BOFU,
  FINE_PRINT,
};

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
  assert.equal('refund' in HERO, false);
});

test('an unfinished purchase is “no charge”, and only in the callout and one FAQ', () => {
  assert.equal(NO_CHARGE, 'Si la compra no se completa, no realizás ningún pago.');
  assert.equal(PAYMENTS.assurance, NO_CHARGE);
  assert.equal(FAQ.filter((item) => item.a === NO_CHARGE).length, 1);

  const elsewhere = JSON.stringify({
    HERO,
    STEPS,
    BENEFITS,
    BOFU,
    FINE_PRINT,
    paymentsBesideCallout: {
      title: PAYMENTS.title,
      lead: PAYMENTS.lead,
      methods: PAYMENTS.methods,
    },
    otherFaq: FAQ.filter((item) => item.a !== NO_CHARGE),
  }).toLowerCase();
  for (const phrase of ['no se completa', 'ningún pago', 'devolvemos', 'reembolso']) {
    assert.equal(elsewhere.includes(phrase), false, phrase);
  }
});

test('landing copy stays free of refund framing, invented-price claims, and jargon', () => {
  const blob = JSON.stringify(COPY).toLowerCase();
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
    'devolvemos',
    'reembolso',
    'reembols',
    'sin vueltas',
    'inventados',
    'inventadas',
    'refund',
  ]) {
    assert.equal(blob.includes(word), false, word);
  }
  assert.equal(STEPS.length, 4);
  assert.equal(BENEFITS.length, 3);
  assert.equal(FAQ.length, 4);
  assert.equal(
    STEPS[0].body,
    'En lenguaje natural: la lista, una receta o lo de la juntada. Changuito busca y calcula con IA.',
  );
  assert.equal(
    FAQ[0].a,
    'No. Es un asistente de IA para el súper: le pedís en tu idioma lo que necesitás — una receta, una juntada, la lista de la semana — y Changuito busca, calcula y te arma el carrito.',
  );
  assert.equal(BENEFITS[1].body, 'Precios reales de supermercado.');
  assert.equal(FINE_PRINT, 'Changuito te ayuda a armar el súper. No es un supermercado.');
});
