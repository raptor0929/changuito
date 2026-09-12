import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  forgetAllSecrets,
  looksLikeCardNumber,
  redact,
  redactToString,
  registerSecret,
} from '../secure/redact.js';

afterEach(() => forgetAllSecrets());

/** Luhn-valid test numbers from the public card-network test ranges. */
const VISA_16 = '4111111111111111';
const MC_16 = '5555555555554444';
const AMEX_15 = '378282246310005';
const DINERS_14 = '30569309025904';
const VISA_13 = '4222222222222';
const VISA_19 = '4111111111111111110';

describe('looksLikeCardNumber', () => {
  it('accepts real-shaped PANs of every permitted length', () => {
    for (const pan of [VISA_13, DINERS_14, AMEX_15, VISA_16, MC_16, VISA_19]) {
      assert.equal(looksLikeCardNumber(pan), true, pan);
    }
  });

  it('accepts PANs written with spaces or dashes', () => {
    assert.equal(looksLikeCardNumber('4111 1111 1111 1111'), true);
    assert.equal(looksLikeCardNumber('4111-1111-1111-1111'), true);
  });

  it('rejects runs that are the right length but fail Luhn', () => {
    assert.equal(looksLikeCardNumber('4111111111111112'), false);
  });

  it('rejects things that are too short or too long', () => {
    assert.equal(looksLikeCardNumber('411111111111'), false);
    assert.equal(looksLikeCardNumber('41111111111111111111'), false);
  });
});

describe('heuristic redaction', () => {
  it('masks a PAN but keeps the last four', () => {
    const out = redactToString(`paying with ${VISA_16} now`);
    assert.ok(!out.includes(VISA_16));
    assert.ok(out.includes('****1111'), out);
  });

  it('masks Vyrion API keys in both environments', () => {
    assert.ok(!redactToString('Bearer sk_live_abcdef1234567890').includes('abcdef1234567890'));
    assert.ok(!redactToString('key=sk_test_abcdef1234567890').includes('abcdef1234567890'));
  });

  it('masks an EVM private key with or without 0x', () => {
    const k = 'a'.repeat(64);
    assert.ok(!redactToString(`key 0x${k}`).includes(k));
    assert.ok(!redactToString(`key ${k}`).includes(k));
  });

  it('masks bearer tokens', () => {
    assert.ok(!redactToString('Authorization: Bearer abc123def456ghi').includes('abc123def456ghi'));
  });
});

describe('false positives — the reason Luhn is in here', () => {
  it('leaves a millisecond timestamp alone', () => {
    // Date.now() is 13 digits and would match a naive 13-19 digit PAN rule.
    const ts = '1758153600000';
    assert.equal(looksLikeCardNumber(ts), false);
    assert.equal(redactToString(`at ${ts}`), `at ${ts}`);
  });

  it('leaves a cart total in centavos alone', () => {
    // 1527177 centavos == $15.271,77 — a real Disco cart value from the probes.
    assert.equal(redactToString('total 1527177'), 'total 1527177');
  });

  it('leaves VTEX SKU ids and orderForm ids alone', () => {
    const s = 'sku=392452 orderFormId=a1b2c3d4e5f60718293a4b5c6d7e8f90';
    assert.equal(redactToString(s), s);
  });
});

describe('exact-match registration', () => {
  it('masks a registered secret even when no pattern would catch it', () => {
    registerSecret('hunter2-not-a-pattern', 'pass');
    const out = redactToString('the value is hunter2-not-a-pattern ok');
    assert.ok(!out.includes('hunter2-not-a-pattern'));
    assert.ok(out.includes('[REDACTED:pass]'));
  });

  it('masks a registered CVV, which is far too short for any heuristic', () => {
    registerSecret('7321', 'cvv');
    assert.ok(!redactToString('cvv 7321').includes('7321'));
  });

  it('ignores values under 4 characters, which would shred every log', () => {
    registerSecret('1', 'oops');
    assert.equal(redactToString('item 1 of 10'), 'item 1 of 10');
  });
});

describe('key-aware redaction', () => {
  it('masks DNI by key, because 7-8 digit numbers are also prices', () => {
    const out = redact({ document: '34567890', total: 1527177 });
    assert.equal(out.document, '[REDACTED]');
    assert.equal(out.total, 1527177, 'a centavos total must survive');
  });

  it('masks card, cookie and passphrase fields wholesale', () => {
    const out = redact({
      cardNumber: VISA_16,
      cvv: '123',
      cookie: 'VtexIdclientAutCookie=abc',
      passphrase: 'correct horse battery staple',
      sku: '392452',
    });
    assert.equal(out.cardNumber, '[REDACTED]');
    assert.equal(out.cvv, '[REDACTED]');
    assert.equal(out.cookie, '[REDACTED]');
    assert.equal(out.passphrase, '[REDACTED]');
    assert.equal(out.sku, '392452');
  });

  it('matches keys case-insensitively and in snake_case', () => {
    const out = redact({ API_KEY: 'x', private_key: 'y', SecurityCode: 'z' });
    assert.deepEqual(out, {
      API_KEY: '[REDACTED]',
      private_key: '[REDACTED]',
      SecurityCode: '[REDACTED]',
    });
  });
});

describe('structural safety', () => {
  it('recurses into nested objects and arrays', () => {
    const out = redact({ a: [{ b: { cvv: '999', pan: VISA_16 } }] });
    assert.equal(out.a[0].b.cvv, '[REDACTED]');
    assert.equal(out.a[0].b.pan, '[REDACTED]');
  });

  it('survives circular references', () => {
    const o: Record<string, unknown> = { name: 'cart' };
    o.self = o;
    assert.doesNotThrow(() => redact(o));
    assert.equal((redact(o) as { self: string }).self, '[circular]');
  });

  it('scrubs error messages and stacks without losing the error', () => {
    const e = redact(new Error(`declined for ${VISA_16}`));
    assert.ok(e instanceof Error);
    assert.ok(!e.message.includes(VISA_16));
  });

  it('never throws, whatever it is handed', () => {
    for (const v of [undefined, null, NaN, Symbol('s'), 10n, () => 1, new Map([['cvv', '1']])]) {
      assert.doesNotThrow(() => redactToString(v));
    }
  });
});
