import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Escalation } from '../checkout/types.js';
import type { AppConfig } from '../config.js';
import { ConfigError } from '../config.js';
import type { Bin } from '../pay/types.js';
import {
  assertCheckoutSupported,
  explain,
  holderNameFrom,
  pickBin,
  postalCodeNote,
  sameAmount,
  toDeliveryAddress,
  type AddressInput,
} from '../tools.js';
import { parseARS } from '../util/money.js';

const addr = (over: Partial<AddressInput> = {}): AddressInput => ({
  street: 'Av. Corrientes',
  number: '1234',
  postal_code: '1425',
  ...over,
});

const bin = (id: string, over: Partial<Bin> = {}): Bin =>
  ({ id, network: 'visa', type: 'prepaid', '3ds': true, ...over }) as Bin;

describe('toDeliveryAddress', () => {
  it('keeps only what was given, trimmed', () => {
    const a = toDeliveryAddress(addr({ complement: '  3º B ', city: ' CABA ' }));
    assert.equal(a.street, 'Av. Corrientes');
    assert.equal(a.complement, '3º B');
    assert.equal(a.city, 'CABA');
    assert.equal(a.state, undefined);
  });

  it('drops blank optionals instead of storing empty strings', () => {
    const a = toDeliveryAddress(addr({ complement: '   ', phone: '' }));
    assert.ok(!('complement' in a));
    assert.ok(!('phone' in a));
  });

  it('accepts both the four-digit and the CPA postal code forms', () => {
    assert.equal(toDeliveryAddress(addr({ postal_code: '1425' })).postalCode, '1425');
    assert.equal(toDeliveryAddress(addr({ postal_code: 'c1425dke' })).postalCode, 'C1425DKE');
    assert.equal(toDeliveryAddress(addr({ postal_code: ' C1425 DKE ' })).postalCode, 'C1425DKE');
  });

  it('refuses a postal code the store would reject anyway', () => {
    assert.throws(() => toDeliveryAddress(addr({ postal_code: '142' })), /not an Argentine postal code/);
    assert.throws(() => toDeliveryAddress(addr({ postal_code: '14255' })), /not an Argentine postal code/);
    assert.throws(() => toDeliveryAddress(addr({ postal_code: 'SW1A 1AA' })), /not an Argentine postal code/);
  });

  it('requires a street and a number', () => {
    assert.throws(() => toDeliveryAddress(addr({ street: '  ' })), /street name is required/);
    assert.throws(() => toDeliveryAddress(addr({ number: '' })), /street number is required/);
  });

  it('RULE: never asks for a name or a DNI — those come from the store profile', () => {
    const a = toDeliveryAddress(addr({ receiver_name: 'Someone Else' })) as unknown as Record<string, unknown>;
    // receiverName is who takes delivery, not who the account holder is.
    assert.equal(a.receiverName, 'Someone Else');
    assert.ok(!('document' in a));
    assert.ok(!('dni' in a));
    assert.ok(!('firstName' in a));
  });
});

describe('postalCodeNote', () => {
  it('says nothing when the address matches where we searched', () => {
    assert.equal(postalCodeNote(toDeliveryAddress(addr()), '1425'), undefined);
  });

  it('treats the CPA and four-digit forms of the same area as equal', () => {
    assert.equal(postalCodeNote(toDeliveryAddress(addr({ postal_code: 'C1425DKE' })), '1425'), undefined);
  });

  it('warns when the delivery area differs from the priced area', () => {
    const note = postalCodeNote(toDeliveryAddress(addr({ postal_code: '5000' })), '1425');
    assert.match(note ?? '', /1425/);
    assert.match(note ?? '', /5000/);
    assert.match(note ?? '', /review_order/);
  });

  it('says nothing when no search location was ever set', () => {
    assert.equal(postalCodeNote(toDeliveryAddress(addr()), undefined), undefined);
  });
});

describe('pickBin', () => {
  it('takes the first of the already-ranked list', () => {
    assert.equal(pickBin([bin('a'), bin('b')]).id, 'a');
  });

  it('honours an explicit choice, for walking down the list after a decline', () => {
    assert.equal(pickBin([bin('a'), bin('b')], 'b').id, 'b');
  });

  it('refuses an unknown BIN and names the ones that exist', () => {
    assert.throws(() => pickBin([bin('a')], 'zz'), /zz.*not in the 3DS-capable list/s);
    assert.throws(() => pickBin([bin('a')], 'zz'), /Available: a/);
  });

  it('refuses to invent a card when no 3DS-capable BIN exists', () => {
    assert.throws(() => pickBin([]), /no 3DS-capable BINs/);
  });
});

describe('sameAmount', () => {
  it('accepts a restatement that differs only in formatting', () => {
    assert.equal(sameAmount('1.5', '1.50'), true);
    assert.equal(sameAmount('25', ' 25 '), true);
    assert.equal(sameAmount('1_000', '1000'), true);
  });

  it('rejects a different number', () => {
    assert.equal(sameAmount('25', '250'), false);
    assert.equal(sameAmount('25', '25.01'), false);
  });

  it('rejects anything unparseable rather than treating it as zero', () => {
    assert.equal(sameAmount('25', 'twenty five'), false);
    assert.equal(sameAmount('', ''), false);
  });
});

describe('holderNameFrom', () => {
  it('joins the store profile name', () => {
    assert.equal(holderNameFrom({ firstName: 'Ana', lastName: 'Pérez' }), 'Ana Pérez');
  });

  it('copes with only one of the two', () => {
    assert.equal(holderNameFrom({ firstName: 'Ana' }), 'Ana');
  });

  it('refuses rather than typing a blank cardholder', () => {
    assert.throws(() => holderNameFrom(undefined), /requires one/);
    assert.throws(() => holderNameFrom({}), /link_marketplace_account/);
  });
});

describe('assertCheckoutSupported', () => {
  const cfg = (retailer: string): AppConfig => ({ retailer, host: `${retailer}.test` }) as AppConfig;

  it('allows Día', () => {
    assert.doesNotThrow(() => assertCheckoutSupported(cfg('dia')));
  });

  it('refuses the read-only stores, and says what still works', () => {
    assert.throws(() => assertCheckoutSupported(cfg('jumbo')), /Checkout is implemented for Día only/);
    assert.throws(() => assertCheckoutSupported(cfg('carrefour')), /Search and cart building work/);
  });
});

describe('explain', () => {
  it('renders an escalation in full — it is a question, not a crash', () => {
    const e = new Escalation(
      'I do not recognise this screen.',
      { state: 'unknown', confidence: 0, layer: 'escalation', why: 'no match' },
      '/tmp/shot.png',
      'URL: https://x.test/',
    );
    const out = explain(e);
    assert.match(out, /do not recognise/);
    assert.match(out, /URL: https:\/\/x\.test/);
    assert.match(out, /Screenshot: \/tmp\/shot\.png/);
  });

  it('points a misconfiguration at the setup guide', () => {
    assert.match(explain(new ConfigError('RPC_URL', 'RPC_URL is not set.')), /SETUP\.md/);
  });

  it('passes ordinary errors through unchanged', () => {
    assert.equal(explain(new Error('boom')), 'boom');
    assert.equal(explain('boom'), 'boom');
  });
});

describe('parseARS — the approval gate input', () => {
  it('reads the es-AR format the summary prints', () => {
    assert.equal(parseARS('12.345,67'), 1_234_567);
    assert.equal(parseARS('$ 12.345,67'), 1_234_567);
    assert.equal(parseARS('ARS 12.345,67'), 1_234_567);
  });

  it('reads the plain form a person is likely to type', () => {
    assert.equal(parseARS('12345.67'), 1_234_567);
    assert.equal(parseARS('12345,67'), 1_234_567);
    assert.equal(parseARS('12345'), 1_234_500);
  });

  it('treats a lone dot with three digits after it as a thousands separator', () => {
    // "12.345" in Argentina is twelve thousand, not twelve pesos and change.
    assert.equal(parseARS('12.345'), 1_234_500);
  });

  it('handles multiple grouping separators', () => {
    assert.equal(parseARS('1.234.567,89'), 123_456_789);
  });

  it('refuses anything it cannot read, rather than guessing a number', () => {
    assert.throws(() => parseARS('twelve'), /not an amount I can read/);
    assert.throws(() => parseARS(''), /not an amount I can read/);
    assert.throws(() => parseARS('12 pesos'), /not an amount I can read/);
  });

  it('round-trips the exact total the review showed', () => {
    for (const centavos of [1, 99, 100, 123_456, 9_999_999]) {
      const shown = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2,
      }).format(centavos / 100);
      assert.equal(parseARS(shown), centavos, `failed round trip for ${shown}`);
    }
  });
});
