import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSessionState, defaultSession, getLocation, setLocation } from '../session.js';
import type { LocationContext } from '../types.js';

const ctx = (retailer: string, postalCode = '1425'): LocationContext => ({
  retailer,
  country: 'ARG',
  postalCode,
  sellers: [],
  salesChannel: '1',
  degraded: false,
});

describe('createSessionState', () => {
  it('gives each shopper their own location', () => {
    const ana = createSessionState();
    const beto = createSessionState();

    ana.setLocation(ctx('dia', '1425'));
    beto.setLocation(ctx('carrefour', '5000'));

    assert.equal(ana.getLocation()!.retailer, 'dia');
    assert.equal(ana.getLocation()!.postalCode, '1425');
    assert.equal(beto.getLocation()!.retailer, 'carrefour');
  });

  it('gives each shopper their own carts', () => {
    const ana = createSessionState();
    const beto = createSessionState();

    ana.setLocation(ctx('dia'));
    beto.setLocation(ctx('dia'));
    ana.rememberCart('dia', 'cart-ana');
    beto.rememberCart('dia', 'cart-beto');

    assert.equal(ana.snapshot().carts.dia, 'cart-ana');
    assert.equal(beto.snapshot().carts.dia, 'cart-beto');
  });

  it('still drops carts when the same shopper switches supermarket', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'cart-1');
    s.setLocation(ctx('carrefour'));
    assert.deepEqual(s.snapshot().carts, {});
  });

  it('keeps the cart when the location changes but the retailer does not', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia', '1425'));
    s.rememberCart('dia', 'cart-1');
    s.setLocation(ctx('dia', '5000'));
    assert.equal(s.snapshot().carts.dia, 'cart-1');
  });

  it('explains itself when asked for a location it does not have', () => {
    assert.throws(() => createSessionState().requireLocation(), /set_location/);
  });
});

/**
 * A serverless instance is not durable, and losing a cart id is silent: the
 * next `ensureCart` creates an empty cart and `get_cart_link` hands the user a
 * link to it. So a round trip through storage has to be lossless.
 */
describe('snapshot and restore', () => {
  it('survives a round trip through JSON, which is what storage is', () => {
    const before = createSessionState();
    before.setLocation({ ...ctx('dia'), regionId: 'v2.ABC', degraded: true, note: 'no regions' });
    before.rememberCart('dia', 'cart-9');

    const after = createSessionState();
    after.restore(JSON.parse(JSON.stringify(before.snapshot())));

    assert.deepEqual(after.snapshot(), before.snapshot());
    assert.equal(after.getLocation()!.regionId, 'v2.ABC');
    assert.equal(after.getLocation()!.degraded, true);
    assert.equal(after.snapshot().carts.dia, 'cart-9');
  });

  it('hands out a copy, so mutating a snapshot cannot reach back into the session', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'cart-1');

    const snap = s.snapshot();
    snap.carts.dia = 'tampered';

    assert.equal(s.snapshot().carts.dia, 'cart-1');
  });

  it('replaces state rather than merging into it', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'stale');
    s.rememberCart('carrefour', 'also-stale');

    s.restore({ location: ctx('jumbo'), carts: { jumbo: 'fresh' } });

    assert.deepEqual(s.snapshot().carts, { jumbo: 'fresh' });
    assert.equal(s.getLocation()!.retailer, 'jumbo');
  });

  it('restores an empty session without throwing', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.restore({ carts: {} });
    assert.equal(s.getLocation(), undefined);
  });
});

describe('the module-level session', () => {
  it('is what the free functions the stdio binary uses talk to', () => {
    setLocation(ctx('dia', '1414'));
    assert.equal(getLocation()!.postalCode, '1414');
    assert.equal(defaultSession.getLocation()!.postalCode, '1414');
  });

  it('is not shared with a session created by the factory', () => {
    setLocation(ctx('dia', '1414'));
    const mine = createSessionState();
    mine.setLocation(ctx('carrefour', '9999'));
    assert.equal(getLocation()!.retailer, 'dia', 'the factory leaked into the default session');
  });
});
