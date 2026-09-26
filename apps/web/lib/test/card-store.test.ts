import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readHint } from '../card-store.ts';

/**
 * `readHint` is the whole of the mirror that can be tested without a browser:
 * the store functions around it are three lines of try/catch over
 * `localStorage`, and what actually decides whether a PAN can reach the DOM
 * through this file is the validator. It runs on the way *out* as well as on
 * the way in — `rememberCard` packs, validates, and only then writes — so
 * every rule below is enforced in both directions.
 */

const good = {
  cardId: 'card_abc123',
  last4: '4242',
  brand: 'visa',
  network: 'mainnet',
  issuedAt: 1_758_000_000_000,
};
const raw = (o: Record<string, unknown>) => JSON.stringify({ ...good, ...o });

describe('the card hint that outlives the dialog', () => {
  it('reads back a record it wrote', () => {
    assert.deepEqual(readHint(raw({}), 'mainnet'), {
      cardId: 'card_abc123',
      last4: '4242',
      brand: 'visa',
      network: 'mainnet',
      issuedAt: 1_758_000_000_000,
    });
  });

  it('RULE: refuses anything but exactly four digits in the last4 slot', () => {
    // The rule that keeps a PAN out. It is enforced on the way out too, so a
    // caller that hands `rememberCard` a full card number writes nothing at
    // all rather than writing it under an innocent-looking name.
    for (const last4 of ['4111111111111111', '424', '42425', 'abcd', '', '42 42', ' 4242 x']) {
      assert.equal(readHint(raw({ last4 }), 'mainnet'), null, `accepted ${JSON.stringify(last4)}`);
    }
  });

  it('RULE: a record that claims another network is a record in the wrong place', () => {
    // Keyed per network so a card funded with play money can never be
    // mistaken for the one real deposits top up. The key says which network
    // it is; the record has to agree, or it is not read.
    assert.equal(readHint(raw({ network: 'testnet' }), 'mainnet'), null);
    assert.equal(readHint(raw({ network: 'mainnet' }), 'testnet'), null);
    assert.ok(readHint(raw({ network: 'testnet' }), 'testnet'));
  });

  it('drops a record with no card to point at', () => {
    for (const cardId of ['', '   ', 42, null, undefined]) {
      assert.equal(readHint(raw({ cardId }), 'mainnet'), null, `accepted ${String(cardId)}`);
    }
  });

  it('survives whatever is actually in storage', () => {
    // Written by the user's own browser, and editable by hand. Nothing here
    // may throw: the card is authoritative on the server, and a hint that
    // cannot be read is simply a hint that is not shown.
    for (const bad of [null, '', 'not json', '[]', 'null', '"a string"', '{"cardId":{}}']) {
      assert.equal(readHint(bad, 'mainnet'), null, `threw or accepted ${JSON.stringify(bad)}`);
    }
  });

  it('keeps a brand short rather than trusting its length', () => {
    const hint = readHint(raw({ brand: 'x'.repeat(200) }), 'mainnet');
    assert.equal(hint?.brand.length, 24);
  });

  it('treats a missing timestamp as no timestamp, not as a reason to drop it', () => {
    // The date is decoration. Losing it must not cost the shopper the
    // sentence that tells them they already have a card.
    assert.equal(readHint(raw({ issuedAt: 'yesterday' }), 'mainnet')?.issuedAt, 0);
    assert.equal(readHint(raw({ issuedAt: Number.NaN }), 'mainnet')?.issuedAt, 0);
  });
});
