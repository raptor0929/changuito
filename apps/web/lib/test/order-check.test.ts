import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderFormIdFrom, readOrderForm } from '../order-check.ts';

/**
 * The bodies here are trimmed copies of what
 * `diaonline.supermercadosdia.com.ar/api/checkout/pub/orderForm/{id}` actually
 * returned on 2026-09-25, for a cart created and then given a profile through
 * the public API. `loggedIn: false` in both is not a typo — it describes the
 * requester, and the requester is us, with no cookies.
 */
const ID = '438358eb7d7348ec94a3f0c50b4ce228';
const URL_WITH_ID = `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${ID}#/cart`;

const anonymous = {
  orderFormId: ID,
  loggedIn: false,
  canEditData: true,
  userProfileId: null,
  userType: null,
  clientProfileData: null,
  items: [{ id: '1' }, { id: '2' }],
  value: 615000,
};

const identified = {
  ...anonymous,
  clientProfileData: {
    email: 'someone@example.com',
    firstName: 'Ana',
    document: '30123456',
    documentType: 'dni',
  },
};

function stub(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const probe = { retailer: 'dia', orderFormId: ID, itemsAtHandoff: 2 };

describe('reading a cart from outside it', () => {
  it('says nobody is attached to a fresh cart', async () => {
    const state = await readOrderForm(probe, stub(anonymous));
    assert.equal(state?.identified, false);
    assert.equal(state?.items, 2);
    assert.equal(state?.value, 615000);
  });

  it('notices once a profile is attached', async () => {
    const state = await readOrderForm(probe, stub(identified));
    assert.equal(state?.identified, true);
  });

  it('RULE: the profile itself never comes back', async () => {
    const state = await readOrderForm(probe, stub(identified));
    // Verified by hand: this endpoint returns the email, the name and the DNI
    // unmasked to anyone holding the cart id. None of it may reach a caller,
    // a log or a receipt — `identified` is the entire answer.
    const serialised = JSON.stringify(state);
    for (const secret of ['someone@example.com', 'Ana', '30123456', 'dni']) {
      assert.equal(serialised.includes(secret), false, secret);
    }
    assert.deepEqual(Object.keys(state!).sort(), ['identified', 'items', 'looksPaid', 'value']);
  });

  it('an emptied cart with a profile on it looks paid', async () => {
    const paid = { ...identified, items: [], value: 0 };
    assert.equal((await readOrderForm(probe, stub(paid)))?.looksPaid, true);
  });

  it('a still-full cart does not', async () => {
    assert.equal((await readOrderForm(probe, stub(identified)))?.looksPaid, false);
  });

  it('RULE: a cart that was empty to begin with never looks paid', async () => {
    const paid = { ...identified, items: [], value: 0 };
    const fromEmpty = await readOrderForm({ ...probe, itemsAtHandoff: 0 }, stub(paid));
    assert.equal(fromEmpty?.looksPaid, false);
  });

  it('RULE: an id nobody ever used does not look paid', async () => {
    // Checked against the real store: asking for a 32-hex id that was never
    // issued returns 200 with that id, zero items and a zero value. Without
    // the profile condition this exact body reads as a completed purchase,
    // which would write a receipt for an order that does not exist.
    const neverExisted = { ...anonymous, items: [], value: 0 };
    const state = await readOrderForm(probe, stub(neverExisted));
    assert.equal(state?.identified, false);
    assert.equal(state?.looksPaid, false);
  });

  it('returns null rather than throwing, for every way this can fail', async () => {
    const dead = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    assert.equal(await readOrderForm(probe, dead), null);
    assert.equal(await readOrderForm(probe, stub({}, 404)), null);
    assert.equal(await readOrderForm(probe, stub('not an object')), null);
    assert.equal(await readOrderForm(probe, stub(null)), null);
    // A store we do not serve, and an id that is not one.
    assert.equal(await readOrderForm({ ...probe, retailer: 'coto' }, stub(anonymous)), null);
    assert.equal(await readOrderForm({ ...probe, orderFormId: '../../etc' }, stub(anonymous)), null);
    assert.equal(await readOrderForm({ ...probe, orderFormId: '' }, stub(anonymous)), null);
  });

  it('survives a body missing the fields it reads', async () => {
    const state = await readOrderForm(probe, stub({ orderFormId: ID }));
    assert.deepEqual(state, { identified: false, items: 0, value: 0, looksPaid: false });
  });
});

describe('the cart id in a handoff url', () => {
  it('finds it', () => {
    assert.equal(orderFormIdFrom(URL_WITH_ID), ID);
  });

  it('refuses anything that is not one', () => {
    for (const bad of [
      'not a url',
      'https://diaonline.supermercadosdia.com.ar/checkout',
      `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=short`,
      `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${'z'.repeat(32)}`,
    ]) {
      assert.equal(orderFormIdFrom(bad), null, bad);
    }
  });
});
