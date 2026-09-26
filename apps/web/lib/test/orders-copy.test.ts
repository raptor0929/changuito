import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dollars,
  KEPT_CARD,
  ORDER_STATUS,
  pesos,
  purchaseDate,
  PURCHASES,
  PURCHASES_COPY,
} from '../orders-copy.ts';

/** The same list checkout-copy.test.ts and mode-copy.test.ts enforce. Three files, one rule. */
const FORBIDDEN =
  /\b(testnet|mainnet|blockchain|wallet|billetera virtual|on-chain|cripto|crypto|web3|defi|stellar|soroban|mcp|escrow|smart ?contract)\b/i;

describe('the purchases page copy', () => {
  it('RULE: never names a network, a chain or a wallet', () => {
    for (const text of PURCHASES_COPY) {
      assert.doesNotMatch(text, FORBIDDEN, `forbidden word in: ${text}`);
    }
  });

  it('speaks voseo, never tuteo', () => {
    const all = PURCHASES_COPY.join(' ');
    assert.match(all, /probás|Entrá|compraste|Probá/);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú|entra tu|pruebas de nuevo|compraste tú)\b/i);
  });

  it('RULE: tells a signed-out visitor nothing is kept, rather than that it is empty', () => {
    // "No tenés compras" would be a claim about them. The truth is a claim
    // about us: preview writes nothing down, so there is nothing to have.
    assert.match(PURCHASES.guestBody, /no guardamos nada/i);
  });

  it('RULE: the way into the real mode says the same words as the masthead', () => {
    // Two different sentences for one crossing would read as two crossings.
    assert.equal(PURCHASES.guestAction, 'Cambiar a modo real');
  });

  it('RULE: warns about the signature before asking for it', () => {
    assert.match(PURCHASES.signLead, /firma/i);
    assert.match(PURCHASES.signLead, /no mueve plata/i);
  });
});

describe('the words that guard giving the card back', () => {
  it('RULE: says it cannot be undone, before the press that does it', () => {
    // The only irreversible thing on the page. A warning that arrives after
    // the act is not a warning, so the whole of it sits between the two
    // presses — and the test is here because a later edit shortening it for
    // layout would be an easy, invisible mistake to make.
    assert.match(KEPT_CARD.retireWarn, /no se puede deshacer/i);
    assert.match(KEPT_CARD.retireWarn, /para siempre/i);
  });

  it('RULE: says where the money goes, since that is the question', () => {
    assert.match(KEPT_CARD.retireWarn, /saldo/i);
    assert.match(KEPT_CARD.retired, /saldo/i);
  });

  it('the two answers are not both yes', () => {
    // A confirm and a cancel that read alike is how somebody destroys a card
    // they meant to keep. One says "sí" and the other says "no", in that
    // many words, rather than "Aceptar" / "Cancelar".
    assert.match(KEPT_CARD.retireConfirm, /^sí/i);
    assert.match(KEPT_CARD.retireCancel, /^no/i);
    assert.notEqual(KEPT_CARD.retireConfirm, KEPT_CARD.retireCancel);
  });

  it('RULE: a frozen card promises nothing, because there is no way back', () => {
    // Vyrion has `freezeCard` and no unfreeze. Copy that said "escribinos y
    // la destrabamos" would be an offer this app cannot honour.
    assert.match(KEPT_CARD.frozen, /bloqueada/i);
    assert.doesNotMatch(KEPT_CARD.frozen, /destrab|desbloque|escribinos|contactanos/i);
  });

  it('RULE: having no card is not an error', () => {
    // Most people have never had one. The first shop makes it, and the
    // sentence says so rather than reading as something that went wrong.
    assert.doesNotMatch(KEPT_CARD.none, /error|no pudimos|problema/i);
    assert.match(KEPT_CARD.none, /primera compra/i);
  });
});

describe('what a status is called', () => {
  it('RULE: a paid order and a carded one read the same', () => {
    // The card is machinery. A separate word would invite the shopper to
    // wonder what they are meant to do about a state they cannot act on.
    assert.equal(ORDER_STATUS.paid, ORDER_STATUS.carded);
  });

  it('RULE: an unpaid order does not say we are still waiting', () => {
    // It can sit there for ever — a código was minted and nothing was sent.
    assert.doesNotMatch(ORDER_STATUS.quoted, /esperando|aguardando/i);
  });

  it('every status has a word, and none of them is a status name', () => {
    for (const [status, word] of Object.entries(ORDER_STATUS)) {
      assert.ok(word.length > 0, `${status} has no word`);
      assert.doesNotMatch(word, /^(quoted|paid|carded|done|failed)$/i);
    }
  });
});

describe('the two figures on a line', () => {
  it('writes centavos as pesos', () => {
    assert.match(pesos(123_456), /1\.234,56/);
    assert.match(pesos(0), /0,00/);
  });

  it('writes US cents with a comma, like every other number on the page', () => {
    assert.equal(dollars(1234), 'US$ 12,34');
    assert.equal(dollars(7), 'US$ 0,07');
  });

  it('RULE: a date it cannot read is empty, not "Invalid Date"', () => {
    // `created_at` comes off the wire as a string. A row written by something
    // other than this app must not put the word "Invalid" on the page.
    assert.equal(purchaseDate('not a date'), '');
    assert.equal(purchaseDate(''), '');
    assert.notEqual(purchaseDate('2026-09-26T12:00:00.000Z'), '');
  });
});
