import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CHECKOUT_MODES, checkoutCopy } from '../checkout-copy.ts';

/** The same list mode-copy.test.ts enforces. Two files, one rule. */
const FORBIDDEN =
  /\b(testnet|mainnet|blockchain|wallet|billetera virtual|on-chain|cripto|crypto|web3|defi|stellar|soroban|mcp|escrow|smart ?contract)\b/i;

const every = CHECKOUT_MODES.flatMap((m) => Object.values(m));

describe('checkout copy', () => {
  it('RULE: never names a network, a chain or a wallet', () => {
    for (const text of every) assert.doesNotMatch(text, FORBIDDEN, `forbidden word in: ${text}`);
  });

  it('speaks voseo, never tuteo', () => {
    const all = every.join(' ');
    assert.match(all, /mandá|pagaste|seguí|Escribinos/i);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú|envía|sigue|escríbenos)\b/i);
  });

  it('RULE: says a refund is manual, in the mode where the money is real', () => {
    // There is no outbound payment path in this deployment and no key to sign
    // one with. Copy that implied otherwise would be a promise nothing keeps.
    assert.match(checkoutCopy('mainnet').refundNote, /a mano/);
    assert.match(checkoutCopy('mainnet').failed, /a mano/);
  });

  it('RULE: says plainly, in test mode, that nothing real moves', () => {
    assert.match(checkoutCopy('testnet').refundNote, /no se mueve plata real/i);
    assert.match(checkoutCopy('testnet').depositLead, /prueba/i);
  });

  it('RULE: never claims the payment itself was confirmed', () => {
    // The store's public API cannot show us an order. All it shows is that
    // the cart closed, so that is all the words are allowed to say.
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.verified, /confirmamos tu pago|pago confirmado/i);
      assert.match(m.verified, /changuito se cerró/);
    }
  });

  it('RULE: not-verified never reads as not-paid', () => {
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.unverified, /no pagaste|no se pagó/i);
      assert.match(m.unverified, /Si ya pagaste/);
    }
  });

  it('RULE: the tab is an equal path, not a failure', () => {
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.openTabNote, /error|falló|no funciona\b/i);
      assert.match(m.openTabNote, /Funciona igual/);
    }
  });

  it('says the memo is not optional', () => {
    for (const m of CHECKOUT_MODES) assert.match(m.memoNote, /sí o sí/);
  });
});

describe('the single-use card', () => {
  it('RULE: is offered as an alternative, never as the only way to pay', () => {
    // The frame is the store's own checkout and takes the shopper's own card
    // for free. A deployment without a card provider still works, so the copy
    // has to read the same way the code behaves.
    for (const m of CHECKOUT_MODES) {
      assert.match(m.cardLead, /tu tarjeta de siempre/);
      // The reason line changes with the failure; this one never does, which
      // is what stops a card failure reading as a dead end.
      assert.match(m.cardFallback, /Podés pagar con la tuya/);
    }
  });

  it('RULE: says the numbers are not kept', () => {
    // They live in React state for the length of the dialog and nowhere else.
    // If that ever changes, this sentence becomes a lie and this test is where
    // it gets caught.
    for (const m of CHECKOUT_MODES) assert.match(m.cardNote, /No la guardamos/);
  });
});
