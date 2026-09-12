import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ask, classifyWithJev, compactState, vetoPaymentScreen } from '../checkout/classify/jev.js';
import { emptyPageState } from '../checkout/pagestate.js';
import { loadConfig } from '../config.js';

const ON = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s', TYPESAFE_API_KEY: 'ts_key_123' });
const OFF = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s' });

function stubFetch(result: { status?: number; body?: unknown; throws?: Error }) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (result.throws) throw result.throws;
    sent.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const answer = (choice: string, confidence: number, extra: Record<string, unknown> = {}) => ({
  answers: { page: { choice, confidence }, ...extra },
});

const UNKNOWN_SCREEN = emptyPageState({
  url: 'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=abc#/shipping',
  headings: ['Necesitamos un dato más'],
  buttons: ['Continuar'],
});

describe('classifyWithJev', () => {
  it('returns nothing at all when Jev is disabled, without calling anything', async () => {
    const { fetchImpl, sent } = stubFetch({ body: answer('address_confirm', 0.99) });
    assert.equal(await classifyWithJev(OFF, UNKNOWN_SCREEN, { fetchImpl }), undefined);
    assert.equal(sent.length, 0);
  });

  it('accepts a confident answer from the allowed set', async () => {
    const { fetchImpl } = stubFetch({ body: answer('address_confirm', 0.91) });
    const v = await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl });
    assert.equal(v?.state, 'address_confirm');
    assert.equal(v?.layer, 'jev');
    assert.equal(v?.confidence, 0.91);
  });

  it('FAILS CLOSED below the confidence floor', async () => {
    const { fetchImpl } = stubFetch({ body: answer('payment_form', 0.74) });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('accepts exactly the floor', async () => {
    const { fetchImpl } = stubFetch({ body: answer('payment_form', 0.75) });
    assert.equal((await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }))?.state, 'payment_form');
  });

  it('FAILS CLOSED on a network error rather than retrying into a money path', async () => {
    const { fetchImpl } = stubFetch({ throws: new Error('ECONNRESET') });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('FAILS CLOSED on an HTTP error', async () => {
    const { fetchImpl } = stubFetch({ status: 500 });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('FAILS CLOSED on a malformed body', async () => {
    const { fetchImpl } = stubFetch({ body: { nonsense: true } });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('refuses a state outside the allowed set, however confident', async () => {
    const { fetchImpl } = stubFetch({ body: answer('transfer_all_funds', 1) });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('treats an explicit "unknown" as no answer', async () => {
    const { fetchImpl } = stubFetch({ body: answer('unknown', 0.99) });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('treats a missing confidence as zero', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { page: { choice: 'payment_form' } } } });
    assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
  });

  it('carries the 3DS presentation back when it names one', async () => {
    const { fetchImpl } = stubFetch({
      body: answer('threeds', 0.95, { threeds_kind: { choice: 'iframe', confidence: 0.9 } }),
    });
    const v = await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl });
    assert.equal(v?.threeDsKind, 'iframe');
  });

  it('does not attach a 3DS kind to a non-3DS screen', async () => {
    const { fetchImpl } = stubFetch({
      body: answer('payment_form', 0.95, { threeds_kind: { choice: 'none', confidence: 0.9 } }),
    });
    assert.equal((await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }))?.threeDsKind, undefined);
  });

  it('asks both questions in a single round trip', async () => {
    const { fetchImpl, sent } = stubFetch({ body: answer('cart', 0.99) });
    await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl });
    assert.equal(sent.length, 1);
    const body = sent[0].body as { questions: Record<string, unknown>; model: string };
    assert.deepEqual(Object.keys(body.questions).sort(), ['page', 'threeds_kind']);
    assert.equal(body.model, 'jev-latest');
    assert.match(sent[0].headers.Authorization, /^Bearer /);
  });
});

describe('vetoPaymentScreen — it can stop a payment, never authorise one', () => {
  const PAY = emptyPageState({ headings: ['Pagá tu compra'], fields: [{ label: 'Número de tarjeta', type: 'text', required: true, filled: false }] });

  it('is a no-op when Jev is disabled — deterministic checks still apply', async () => {
    assert.equal((await vetoPaymentScreen(OFF, PAY)).safe, true);
  });

  it('allows the payment when Jev sees nothing wrong', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'looks_normal', confidence: 0.96 } } } });
    assert.equal((await vetoPaymentScreen(ON, PAY, { fetchImpl })).safe, true);
  });

  it('BLOCKS the payment when Jev flags the screen', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'something_wrong', confidence: 0.9 } } } });
    const r = await vetoPaymentScreen(ON, PAY, { fetchImpl });
    assert.equal(r.safe, false);
    assert.match(r.why, /flagged/);
  });

  it('BLOCKS when Jev is unsure — an unsure classifier is not an approval', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'looks_normal', confidence: 0.4 } } } });
    assert.equal((await vetoPaymentScreen(ON, PAY, { fetchImpl })).safe, false);
  });

  it('BLOCKS when Jev is unreachable', async () => {
    const { fetchImpl } = stubFetch({ throws: new Error('timeout') });
    const r = await vetoPaymentScreen(ON, PAY, { fetchImpl });
    assert.equal(r.safe, false);
    assert.match(r.why, /unreachable/);
  });
});

describe('what leaves the process', () => {
  it('sends labels, never values — there is no route for a card number', async () => {
    const ps = emptyPageState({
      url: 'https://dia/checkout/?orderFormId=SECRET123#/payment',
      fields: [
        { label: 'Número de tarjeta', type: 'text', required: true, filled: true },
        { label: 'CVV', type: 'text', required: true, filled: true },
      ],
    });
    const payload = JSON.stringify(compactState(ps));
    assert.ok(!payload.includes('4111'), payload);
    assert.match(payload, /Número de tarjeta \(text, required\)/);
    assert.ok(!/"value"/.test(payload));
  });

  it('strips the query string, which carries the cart id', () => {
    const c = compactState(emptyPageState({ url: 'https://dia/checkout/?orderFormId=SECRET123#/payment' }));
    assert.ok(!JSON.stringify(c).includes('SECRET123'));
  });

  it('caps the payload so a huge page cannot be shipped wholesale', () => {
    const big = emptyPageState({
      headings: Array.from({ length: 200 }, (_, i) => `h${i}`),
      buttons: Array.from({ length: 200 }, (_, i) => `b${i}`),
    });
    const c = compactState(big) as { headings: string[]; buttons: string[] };
    assert.equal(c.headings.length, 10);
    assert.equal(c.buttons.length, 15);
  });

  it('refuses to call at all without a key', async () => {
    await assert.rejects(ask(OFF, {}, {}), /disabled/);
  });
});
