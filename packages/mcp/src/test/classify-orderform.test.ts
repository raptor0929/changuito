import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import {
  classifyOrderForm,
  collectProblems,
  needsReapproval,
  stepFromUrl,
} from '../checkout/classify/orderform.js';

/**
 * Layer 1 is pure, so the entire main path of the checkout is verifiable here
 * with no browser, no network and no store. These orderForms are shaped the way
 * VTEX actually returns them: sections exist before they are filled in.
 */

const ITEM = { id: '272382', name: 'Leche', quantity: 2, seller: 'ardiaprod1080', sellingPrice: 234_000, availability: 'available' };
const PROFILE = { email: 'me@example.com', firstName: 'Ana', document: '30123456', documentType: 'dni' };
const ADDRESS = { street: 'Av. Corrientes', number: '1234', postalCode: '1043', city: 'CABA' };

const stage = {
  empty: (): VtexOrderForm => ({ orderFormId: 'of1', items: [] }),
  anonymous: (): VtexOrderForm => ({ orderFormId: 'of1', items: [ITEM], clientProfileData: null }),
  needsAddress: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: null, logisticsInfo: [] },
  }),
  needsSlot: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: ADDRESS, logisticsInfo: [{ itemIndex: 0, selectedSla: null, slas: [{ id: 'Entrega estándar' }] }] },
  }),
  needsPayment: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: ADDRESS, logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega estándar' }] },
    paymentData: { payments: [] },
  }),
  ready: (): VtexOrderForm => ({
    ...stage.needsPayment(),
    paymentData: { payments: [{ paymentSystem: '2', value: 618_000 }] },
  }),
  placed: (): VtexOrderForm => ({ ...stage.ready(), orderGroup: '1509876543210' }),
};

describe('the happy path, one stage at a time', () => {
  it('an empty cart is not a checkout', () => {
    assert.equal(classifyOrderForm(stage.empty())?.state, 'empty_cart');
  });

  it('no email means not signed in', () => {
    const v = classifyOrderForm(stage.anonymous());
    assert.equal(v?.state, 'profile');
    assert.match(v!.why, /not signed in/);
  });

  it('a null address means the address step', () => {
    assert.equal(classifyOrderForm(stage.needsAddress())?.state, 'address');
  });

  it('an address with no selectedSla means the slot picker', () => {
    const v = classifyOrderForm(stage.needsSlot());
    assert.equal(v?.state, 'shipping_slot');
    assert.match(v!.why, /1 of 1 item group/);
  });

  it('no payments attached means the card form', () => {
    assert.equal(classifyOrderForm(stage.needsPayment())?.state, 'payment_form');
  });

  it('an orderGroup is the one unambiguous success signal', () => {
    const v = classifyOrderForm(stage.placed());
    assert.equal(v?.state, 'confirmation');
    assert.match(v!.why, /1509876543210/);
  });

  it('ranks a placed order above every other signal', () => {
    // Even with an empty cart and no profile: if the order exists, it exists.
    const v = classifyOrderForm({ orderFormId: 'of1', items: [], orderGroup: 'g1' });
    assert.equal(v?.state, 'confirmation');
  });

  it('every verdict from this layer is certain', () => {
    for (const build of Object.values(stage)) {
      const v = classifyOrderForm(build(), 'https://x/checkout/#/cart');
      assert.equal(v?.confidence, 1, v?.state);
      assert.equal(v?.layer, 'orderform');
    }
  });
});

describe('addresses that exist but are not usable', () => {
  it('treats a created-but-blank address as the address step', () => {
    const of = stage.needsAddress();
    of.shippingData = { address: { addressId: 'a1', country: 'ARG' }, logisticsInfo: [] };
    assert.equal(classifyOrderForm(of)?.state, 'address');
  });

  it('accepts street plus postal code when there is no street number', () => {
    const of = stage.needsSlot();
    of.shippingData!.address = { street: 'Ruta 8 km 40', postalCode: '1615' };
    assert.equal(classifyOrderForm(of)?.state, 'shipping_slot');
  });

  it('rejects a postal code with no street', () => {
    const of = stage.needsSlot();
    of.shippingData!.address = { postalCode: '1615' };
    assert.equal(classifyOrderForm(of)?.state, 'address');
  });
});

describe('partially chosen delivery', () => {
  it('asks for a slot when only some item groups have one', () => {
    const of = stage.needsSlot();
    of.shippingData!.logisticsInfo = [
      { itemIndex: 0, selectedSla: 'Estándar' },
      { itemIndex: 1, selectedSla: null },
    ];
    const v = classifyOrderForm(of);
    assert.equal(v?.state, 'shipping_slot');
    assert.match(v!.why, /1 of 2/);
  });

  it('does not invent a slot step when the store sent no logisticsInfo at all', () => {
    const of = stage.needsSlot();
    of.shippingData!.logisticsInfo = [];
    assert.equal(classifyOrderForm(of)?.state, 'payment_form');
  });
});

describe('what this layer refuses to answer', () => {
  it('returns nothing without an orderForm, rather than guessing', () => {
    assert.equal(classifyOrderForm(undefined), undefined);
  });

  it('declines to name a state once every section is satisfied and we are off-checkout', () => {
    // The document cannot tell us whether the button has been pressed. Saying
    // so is what hands control to Layer 2.
    assert.equal(classifyOrderForm(stage.ready(), 'https://dia/producto/leche'), undefined);
  });

  it('calls it processing on the payment route with everything attached', () => {
    const v = classifyOrderForm(stage.ready(), 'https://dia/checkout/#/payment');
    assert.equal(v?.state, 'processing');
  });
});

describe('problems travel with every verdict', () => {
  it('surfaces a price-change message on whatever screen it arrives', () => {
    const of = stage.needsPayment();
    of.messages = [{ code: 'priceChanged', text: 'El precio de Leche cambió' }];
    const v = classifyOrderForm(of);
    assert.equal(v?.state, 'payment_form');
    assert.deepEqual(v?.problems, ['El precio de Leche cambió']);
  });

  it('flags an item that went out of stock while we shopped', () => {
    const of = stage.needsPayment();
    of.items = [{ ...ITEM, availability: 'withoutStock' }];
    assert.match(collectProblems(of).join(' '), /Leche: withoutStock/);
  });

  it('does not treat a success notice as a problem', () => {
    const of = stage.needsPayment();
    of.messages = [{ text: 'Cupón aplicado', status: 'success' }];
    assert.equal(collectProblems(of).length, 0);
    assert.equal(classifyOrderForm(of)?.problems, undefined);
  });

  it('knows which messages mean the user must approve again', () => {
    assert.equal(needsReapproval({ messages: [{ text: 'El precio cambió' }] }), true);
    assert.equal(needsReapproval({ messages: [{ code: 'withoutStock', text: 'x' }] }), true);
    assert.equal(needsReapproval({ messages: [{ text: 'Envío gratis' }] }), false);
    assert.equal(needsReapproval({}), false);
  });
});

describe('stepFromUrl', () => {
  it('reads the VTEX route hash', () => {
    assert.equal(stepFromUrl('https://dia/checkout/#/cart'), 'cart');
    assert.equal(stepFromUrl('https://dia/checkout/#/profile'), 'profile');
    assert.equal(stepFromUrl('https://dia/checkout/#/shipping'), 'address');
    assert.equal(stepFromUrl('https://dia/checkout/#/payment'), 'payment_form');
  });

  it('recognises the order-placed page, which has no hash', () => {
    assert.equal(stepFromUrl('https://dia/checkout/orderPlaced/?og=123'), 'confirmation');
  });

  it('says nothing about a page it does not know', () => {
    assert.equal(stepFromUrl('https://dia/leche/p'), undefined);
  });
});
