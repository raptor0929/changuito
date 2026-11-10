import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { placeToSet, priorLines, shopperPlace } from '../shopper-location.ts';

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

  it('reads a CPA and a code inside a short reply', () => {
    assert.deepEqual(shopperPlace(['C1414ABC']), {
      retailer: 'dia',
      postalCode: 'C1414ABC',
      namedStore: false,
    });
    assert.deepEqual(shopperPlace(['es 1181']), { retailer: 'dia', postalCode: '1181', namedStore: false });
    assert.deepEqual(shopperPlace(['1181 día']), { retailer: 'dia', postalCode: '1181', namedStore: true });
  });

  it('leaves a number inside a long grocery request alone', () => {
    assert.equal(shopperPlace(['Necesito arroz, fideos y aceite, y si hay huevos de 1181 no los tomes']), null);
  });

  it('replaces a postal code already on the session and keeps the store', () => {
    assert.deepEqual(placeToSet({ retailer: 'dia', postalCode: '1425' }, ['1181']), {
      retailer: 'dia',
      postalCode: '1181',
    });
    assert.equal(placeToSet({ retailer: 'dia', postalCode: '1181' }, ['1181']), null);
    assert.deepEqual(placeToSet({ retailer: 'jumbo', postalCode: '1414' }, ['1181']), {
      retailer: 'jumbo',
      postalCode: '1181',
    });
    assert.deepEqual(placeToSet({ retailer: 'dia', postalCode: '1425' }, ['jumbo 1602']), {
      retailer: 'jumbo',
      postalCode: '1602',
    });
  });

  it('keeps only short text lines from the request', () => {
    assert.deepEqual(priorLines([' 1181 ', 4, '', 'dia', 'x'.repeat(501)]), ['1181', 'dia']);
    assert.equal(priorLines('1181').length, 0);
    assert.equal(priorLines(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 6);
  });
});
