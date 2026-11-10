import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lastShown, recallPair, shownProducts } from '../chat-recall.ts';

describe('shown products', () => {
  it('keeps a name and a sku and drops a price', () => {
    assert.deepEqual(
      shownProducts([
        { skuId: '272382', name: 'Arroz Día 1kg', price: 1800 },
        { skuId: 'not a sku', name: 'Nope' },
        { skuId: '99', name: '   ' },
      ]),
      [{ skuId: '272382', name: 'Arroz Día 1kg' }],
    );
  });

  it('uses the last grid on screen', () => {
    assert.deepEqual(
      lastShown([
        { kind: 'products', items: [{ skuId: '1', name: 'Primero' }] },
        { kind: 'say' },
        { kind: 'products', items: [{ skuId: '2', name: 'Segundo' }] },
      ]),
      [{ skuId: '2', name: 'Segundo' }],
    );
  });
});

describe('recallPair', () => {
  it('tells the model the postal code and the products were already given', () => {
    const pair = recallPair({
      prior: ['1181'],
      shown: [{ skuId: '272382', name: 'Arroz' }],
    });
    assert.equal(pair?.user, '1181');
    assert.match(pair?.assistant ?? '', /set_location/);
    assert.match(pair?.assistant ?? '', /add_to_cart/);
    assert.match(pair?.assistant ?? '', /Arroz \(sku 272382\)/);
  });

  it('is empty when the browser sent nothing', () => {
    assert.equal(recallPair({ prior: [], shown: [] }), null);
  });
});
