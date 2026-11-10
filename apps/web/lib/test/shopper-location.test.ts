import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { priorLines, shopperPlace } from '../shopper-location.ts';

describe('shopperPlace', () => {
  it('reads a postal code and a store the shopper already typed', () => {
    assert.deepEqual(shopperPlace(['Armá un desayuno', '1181', 'dia']), {
      retailer: 'dia',
      postalCode: '1181',
      namedStore: true,
    });
  });

  it('uses Día when they gave a postal code and no store', () => {
    assert.deepEqual(shopperPlace(['1181']), { retailer: 'dia', postalCode: '1181', namedStore: false });
    assert.deepEqual(shopperPlace(['cp 1425', 'jumbo']), { retailer: 'jumbo', postalCode: '1425', namedStore: true });
  });

  it('does not treat a price inside a sentence as a postal code', () => {
    assert.equal(shopperPlace(['leche a $1181']), null);
    assert.equal(shopperPlace(['dia']), null);
  });

  it('keeps only short text lines from the request', () => {
    assert.deepEqual(priorLines([' 1181 ', 4, '', 'dia', 'x'.repeat(501)]), ['1181', 'dia']);
    assert.equal(priorLines('1181').length, 0);
    assert.equal(priorLines(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 6);
  });
});
