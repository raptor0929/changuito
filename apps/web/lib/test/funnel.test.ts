import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { sanitizeProps } from '../analytics.ts';
import { openFailureMessage } from '../checkout/failure.ts';
import { FUNNEL_EVENTS, lockFailureCode, refundFailureCode } from '../funnel.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('beta funnel', () => {
  it('names exactly the seven beta events', () => {
    assert.deepEqual([...FUNNEL_EVENTS], ['login', 'faucet', 'cart_built', 'pay_open', 'settle', 'refund', 'failure']);
  });

  it('every event is wired somewhere in the shopper UI', () => {
    const ui = ['../../components/WalletWidget.tsx', '../../components/CheckoutModal.tsx', '../../components/Chat.tsx']
      .map(src)
      .join('\n');
    for (const e of FUNNEL_EVENTS) assert.match(ui, new RegExp(`track\\('${e}'`), `${e} is never tracked`);
  });

  it('refund codes are codes, never the sentence', () => {
    assert.equal(refundFailureCode({ mode: 'demo' }), 'demo');
    assert.equal(refundFailureCode({ payment: 'declined' }), 'declined');
    assert.equal(refundFailureCode({ error: 'Día pidió una verificación (reCAPTCHA) antes de cobrar' }), 'recaptcha');
    assert.equal(refundFailureCode({ payment: 'error' }), 'payment_error');
    assert.equal(refundFailureCode({ phase: 'checkout' }), 'phase_checkout');
    assert.equal(refundFailureCode({ phase: 'juan@example.com' }), 'refund');
  });

  it('lock failures map from the copy the server sends', () => {
    assert.equal(lockFailureCode(openFailureMessage(new Error('insufficient lamports 1, need 2'))), 'insufficient_sol');
    assert.equal(lockFailureCode(openFailureMessage(new Error('Blockhash not found'))), 'expired');
    assert.equal(lockFailureCode(openFailureMessage(new Error('boom'))), 'lock_failed');
  });

  it('RULE: no personal data survives the props filter', () => {
    assert.deepEqual(
      sanitizeProps({ code: 'recaptcha', email: 'a@b.c', dni: '12345678', password: 'x', amount: 10 }),
      { code: 'recaptcha' },
    );
  });
});
