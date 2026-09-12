import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import { buildEscalation } from '../checkout/classify/escalate.js';
import { classifyDeterministic, onCartPage } from '../checkout/classify/index.js';
import { emptyPageState } from '../checkout/pagestate.js';
import { firstForward, planAction, satisfiesGoal } from '../checkout/states.js';
import type { Verdict } from '../checkout/types.js';

const v = (over: Partial<Verdict>): Verdict => ({
  state: 'cart',
  confidence: 1,
  layer: 'orderform',
  why: 'test',
  ...over,
});

const ctx = { goal: 'confirmation' as const, hasAddress: true };

describe('planAction — what the loop is willing to click', () => {
  it('leaves the cart by the checkout button', () => {
    const ps = emptyPageState({ buttons: ['Seguir comprando', 'Finalizar compra'] });
    const a = planAction(v({ state: 'cart' }), ps, ctx);
    assert.equal(a.kind, 'click');
    assert.equal(a.kind === 'click' && a.label, 'Finalizar compra');
  });

  it('prefers the most specific forward button when several are present', () => {
    const ps = emptyPageState({ buttons: ['Continuar', 'Ir a pagar'] });
    const a = planAction(v({ state: 'cart' }), ps, ctx);
    assert.equal(a.kind === 'click' && a.label, 'Ir a pagar');
  });

  it('NEVER clicks a button that adds an item, even when it matches', () => {
    const ps = emptyPageState({ buttons: ['Agregar y continuar'] });
    const a = planAction(v({ state: 'cart' }), ps, ctx);
    assert.equal(a.kind, 'none', 'a button that agrega is not a forward button');
  });

  it('stops rather than guessing when the cart has no checkout button', () => {
    const a = planAction(v({ state: 'cart' }), emptyPageState({ buttons: ['Vaciar carrito'] }), ctx);
    assert.equal(a.kind, 'none');
  });

  it('confirms an address the store is showing', () => {
    const ps = emptyPageState({ buttons: ['Editar', 'Confirmar dirección'] });
    const a = planAction(v({ state: 'address_confirm', modalId: 'address_confirm' }), ps, ctx);
    assert.equal(a.kind === 'click' && a.label, 'Confirmar dirección');
  });

  it('fills the address form when we hold an address', () => {
    assert.equal(planAction(v({ state: 'address' }), emptyPageState(), ctx).kind, 'fill_address');
  });

  it('refuses to invent an address when none was captured', () => {
    const a = planAction(v({ state: 'address' }), emptyPageState(), { ...ctx, hasAddress: false });
    assert.equal(a.kind, 'none');
    assert.match(a.why, /none has been set/);
  });

  it('dismisses an interstitial with its registry action, not with the upsell button', () => {
    const ps = emptyPageState({
      dialogText: ['Te puede interesar'],
      buttons: ['Agregar a mi compra', 'No, gracias'],
    });
    const a = planAction(v({ state: 'interstitial', modalId: 'upsell' }), ps, ctx);
    assert.equal(a.kind === 'click' && a.label, 'No, gracias');
  });

  it('stops when an interstitial has no dismiss control we recognise', () => {
    const ps = emptyPageState({ dialogText: ['Te puede interesar'], buttons: ['Agregar'] });
    const a = planAction(v({ state: 'interstitial', modalId: 'upsell' }), ps, ctx);
    assert.equal(a.kind, 'none');
  });

  it('accepts a preselected delivery option but never picks a slot blind', () => {
    const withButton = planAction(
      v({ state: 'shipping_slot' }),
      emptyPageState({ buttons: ['Continuar'] }),
      ctx,
    );
    assert.equal(withButton.kind, 'click');
    const without = planAction(v({ state: 'shipping_slot' }), emptyPageState(), ctx);
    assert.equal(without.kind, 'none');
    assert.match(without.why, /cannot tell which/);
  });

  it('waits on a processing screen instead of clicking again', () => {
    const a = planAction(v({ state: 'processing' }), emptyPageState(), ctx);
    assert.equal(a.kind, 'wait');
    assert.ok(a.kind === 'wait' && a.ms > 0);
  });

  it('hands a changed cart back to the user — price and stock are their call', () => {
    const a = planAction(v({ state: 'cart_changed' }), emptyPageState({ buttons: ['Continuar'] }), ctx);
    assert.equal(a.kind, 'none', 'a forward button is present and still not clicked');
  });

  it('does not try to fill a profile a linked session should already have', () => {
    assert.equal(planAction(v({ state: 'profile' }), emptyPageState(), ctx).kind, 'none');
  });

  it('plans the card only on the payment form', () => {
    assert.equal(planAction(v({ state: 'payment_form' }), emptyPageState(), ctx).kind, 'fill_payment');
    assert.equal(planAction(v({ state: 'threeds' }), emptyPageState(), ctx).kind, 'submit_otp');
  });

  it('has no plan for a state it does not know', () => {
    assert.equal(planAction(v({ state: 'unknown' }), emptyPageState(), ctx).kind, 'none');
  });

  it('is pure — planning twice gives the same plan', () => {
    const ps = emptyPageState({ buttons: ['Finalizar compra'] });
    assert.deepEqual(planAction(v({ state: 'cart' }), ps, ctx), planAction(v({ state: 'cart' }), ps, ctx));
  });
});

describe('firstForward', () => {
  it('returns undefined when nothing moves forward', () => {
    assert.equal(firstForward(emptyPageState({ buttons: ['Volver'] })), undefined);
  });
});

describe('satisfiesGoal', () => {
  it('matches the goal exactly', () => {
    assert.equal(satisfiesGoal('payment_form', 'payment_form'), true);
    assert.equal(satisfiesGoal('cart', 'payment_form'), false);
  });

  it('treats a placed order as satisfying any goal — there is nothing left to drive', () => {
    assert.equal(satisfiesGoal('confirmation', 'payment_form'), true);
    assert.equal(satisfiesGoal('confirmation', 'confirmation'), true);
  });
});

// ---------------------------------------------------------------------------

const ITEM = { id: '1', quantity: 1, seller: '1', price: 1000, name: 'Leche' };
const of = (over: Partial<VtexOrderForm> = {}): VtexOrderForm =>
  ({
    orderFormId: 'ABC',
    items: [ITEM],
    clientProfileData: { email: 'a@b.test', firstName: 'A', document: '12345678' },
    shippingData: {
      address: { street: 'Av Corrientes', number: '1234', postalCode: '1043' },
      logisticsInfo: [{ itemIndex: 0, selectedSla: 'Normal' }],
    },
    paymentData: { payments: [] },
    ...over,
  }) as VtexOrderForm;

describe('classifyDeterministic — how the layers compose', () => {
  it('an orderGroup beats everything, including an open dialog', () => {
    const ps = emptyPageState({ dialogText: ['Te puede interesar'], headings: ['Sumale algo'] });
    const out = classifyDeterministic({ pageState: ps, orderForm: of({ orderGroup: 'OG-1' }) });
    assert.equal(out?.state, 'confirmation');
    assert.equal(out?.layer, 'orderform');
  });

  it('an empty cart beats a modal too', () => {
    const ps = emptyPageState({ dialogText: ['newsletter'], headings: ['Suscribite'] });
    const out = classifyDeterministic({ pageState: ps, orderForm: of({ items: [] }) });
    assert.equal(out?.state, 'empty_cart');
  });

  it('a modal on top wins over the underlying step', () => {
    const ps = emptyPageState({
      url: 'https://d.test/checkout/#/shipping',
      headings: ['¿Es correcta la dirección?'],
      buttons: ['Confirmar'],
    });
    const out = classifyDeterministic({ pageState: ps, orderForm: of() });
    assert.equal(out?.state, 'address_confirm');
    assert.equal(out?.layer, 'modal');
  });

  it("the cart page is 'cart' even when the document says payment is next", () => {
    const ps = emptyPageState({ url: 'https://d.test/checkout/#/cart', buttons: ['Finalizar compra'] });
    const out = classifyDeterministic({ pageState: ps, orderForm: of() });
    assert.equal(out?.state, 'cart', 'otherwise the loop declares victory at the cart');
    assert.match(out!.why, /payment_form/);
  });

  it('falls through to the document once we have left the cart', () => {
    const ps = emptyPageState({ url: 'https://d.test/checkout/#/payment' });
    assert.equal(classifyDeterministic({ pageState: ps, orderForm: of() })?.state, 'payment_form');
  });

  it('attaches store problems to whichever verdict wins', () => {
    const ps = emptyPageState({ url: 'https://d.test/checkout/#/payment' });
    const out = classifyDeterministic({
      pageState: ps,
      orderForm: of({ messages: [{ text: 'El precio de Leche cambió', status: 'error' }] }),
    });
    assert.deepEqual(out?.problems, ['El precio de Leche cambió']);
  });

  it('returns nothing when neither layer recognises the screen', () => {
    assert.equal(classifyDeterministic({ pageState: emptyPageState() }), undefined);
  });

  it('classifies from the page alone when the orderForm could not be read', () => {
    const ps = emptyPageState({ headings: ['Gracias por tu compra'] });
    assert.equal(classifyDeterministic({ pageState: ps })?.state, 'confirmation');
  });
});

describe('onCartPage', () => {
  it('recognises both the checkout route and the store cart page', () => {
    assert.equal(onCartPage('https://d.test/checkout/#/cart'), true);
    assert.equal(onCartPage('https://d.test/carrito?x=1'), true);
    assert.equal(onCartPage('https://d.test/checkout/#/payment'), false);
    assert.equal(onCartPage('https://d.test/cartuchos-de-tinta'), false, 'substring, not a path');
  });
});

describe('buildEscalation', () => {
  it('says what it thinks, what the page is, and that no money moved', () => {
    const ps = emptyPageState({ url: 'https://d.test/checkout/#/payment', buttons: ['Pagar'] });
    const e = buildEscalation(v({ state: 'unknown', confidence: 0.2, layer: 'jev' }), ps, 'unknown_screen');
    assert.equal(e.name, 'Escalation');
    assert.match(e.message, /do not recognise this screen/);
    assert.match(e.message, /unknown \(jev, confidence 0.2\)/);
    assert.match(e.message, /Nothing has been paid/);
    assert.match(e.message, /Buttons: Pagar/);
  });

  it('works with no verdict at all', () => {
    const e = buildEscalation(undefined, emptyPageState(), 'stalled');
    assert.equal(e.verdict.state, 'unknown');
    assert.equal(e.verdict.layer, 'escalation');
  });

  it('surfaces store problems and the screenshot path', () => {
    const e = buildEscalation(
      v({ problems: ['Leche: sin stock'] }),
      emptyPageState(),
      'store_problem',
      'extra context',
      '/tmp/shot.png',
    );
    assert.match(e.message, /Leche: sin stock/);
    assert.match(e.message, /extra context/);
    assert.equal(e.screenshotPath, '/tmp/shot.png');
  });
});
