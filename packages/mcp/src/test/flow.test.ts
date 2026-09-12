import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import { buildEscalation, type EscalationReason } from '../checkout/classify/escalate.js';
import { type FlowDriver, type FlowResult, type Observation, runFlow } from '../checkout/flow.js';
import { emptyPageState, type PageState } from '../checkout/pagestate.js';
import type { Action } from '../checkout/states.js';
import { Escalation, type Goal, type Verdict } from '../checkout/types.js';

/**
 * The loop is tested with no browser at all. That is the point of the driver
 * interface: the logic that decides whether to keep clicking in a checkout
 * about to spend real money is ordinary, deterministic, fast-to-test code.
 */

const ITEM = { id: '1', quantity: 1, seller: '1', price: 1000, name: 'Leche' };

function of(over: Partial<VtexOrderForm> = {}): VtexOrderForm {
  return {
    orderFormId: 'ABC',
    items: [ITEM],
    clientProfileData: { email: 'a@b.test', firstName: 'A', document: '12345678' },
    shippingData: {
      address: { street: 'Av Corrientes', number: '1234', postalCode: '1043' },
      logisticsInfo: [{ itemIndex: 0, selectedSla: 'Normal' }],
    },
    paymentData: { payments: [] },
    ...over,
  } as VtexOrderForm;
}

// ---- the screens, as the store actually presents them ----------------------

const CART: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/cart',
    buttons: ['Seguir comprando', 'Finalizar compra'],
    textLength: 1000,
  }),
  orderForm: of(),
};

const COOKIES: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/cart',
    headings: ['Usamos cookies'],
    buttons: ['Aceptar'],
    textLength: 400,
  }),
  orderForm: of(),
};

const UPSELL: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/shipping',
    dialogText: ['Te puede interesar sumar a tu compra'],
    buttons: ['Agregar a mi compra', 'No, gracias'],
    textLength: 600,
  }),
  orderForm: of(),
};

const ADDRESS_CONFIRM: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/shipping',
    headings: ['¿Es correcta la dirección?'],
    buttons: ['Editar', 'Confirmar'],
    textLength: 700,
  }),
  orderForm: of(),
};

const SLOT: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/shipping',
    headings: ['Elegí el día de entrega'],
    buttons: ['Continuar'],
    textLength: 900,
  }),
  orderForm: of({
    shippingData: {
      address: { street: 'Av Corrientes', number: '1234', postalCode: '1043' },
      logisticsInfo: [{ itemIndex: 0 }],
    },
  } as Partial<VtexOrderForm>),
};

const PAYMENT: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/payment',
    headings: ['Pagá tu compra'],
    fields: [{ label: 'Número de tarjeta', type: 'text', required: true, filled: false }],
    buttons: ['Pagar'],
    textLength: 1200,
  }),
  orderForm: of(),
};

const PROCESSING: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/payment',
    headings: ['Procesando tu pago'],
    textLength: 300,
  }),
  orderForm: of({ paymentData: { payments: [{ paymentSystem: '2' }] } } as Partial<VtexOrderForm>),
};

const CONFIRMED: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/orderPlaced/?og=OG-1',
    headings: ['¡Gracias por tu compra!'],
    textLength: 800,
  }),
  orderForm: of({ orderGroup: 'OG-1' }),
};

const DECLINED: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/payment',
    errors: ['Tu tarjeta fue rechazada'],
    textLength: 500,
  }),
  orderForm: of(),
};

const OUT_OF_STOCK: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/cart',
    errors: ['Leche: sin stock'],
    buttons: ['Finalizar compra'],
    textLength: 800,
  }),
  orderForm: of(),
};

const MYSTERY: Observation = {
  pageState: emptyPageState({
    url: 'https://d.test/checkout/#/interstitial',
    headings: ['Encuesta de satisfacción'],
    buttons: ['Responder'],
    textLength: 500,
  }),
};

// ---- the fake driver -------------------------------------------------------

interface FakeOpts {
  /** Screens returned in order; each successful non-wait action advances one. */
  screens: Observation[];
  /** True to make every action leave the page exactly where it was. */
  stuck?: boolean;
  jev?: (ps: PageState) => Promise<Verdict | undefined>;
  /** Milliseconds the clock jumps per observe(). */
  tickMs?: number;
}

class FakeDriver implements FakeDriverShape {
  index = 0;
  clock = 0;
  performed: Action[] = [];
  slept = 0;
  escalations: Array<{ reason: EscalationReason; verdict?: Verdict }> = [];
  readonly classifyJev?: (ps: PageState) => Promise<Verdict | undefined>;

  constructor(private readonly o: FakeOpts) {
    if (o.jev) this.classifyJev = o.jev;
  }

  async observe(): Promise<Observation> {
    this.clock += this.o.tickMs ?? 1;
    return this.o.screens[Math.min(this.index, this.o.screens.length - 1)]!;
  }

  async perform(action: Action): Promise<void> {
    this.performed.push(action);
    if (!this.o.stuck) this.index++;
  }

  async escalate(
    verdict: Verdict | undefined,
    obs: Observation,
    reason: EscalationReason,
    extra?: string,
  ): Promise<Escalation> {
    this.escalations.push({ reason, verdict });
    return buildEscalation(verdict, obs.pageState, reason, extra);
  }

  now(): number {
    return this.clock;
  }

  async sleep(ms: number): Promise<void> {
    this.slept += ms;
    this.clock += ms;
  }
}

type FakeDriverShape = FlowDriver;

const run = (d: FlowDriver, goal: Goal = 'payment_form', over = {}): Promise<FlowResult> =>
  runFlow(d, { goal, ...over });

async function expectEscalation(p: Promise<unknown>): Promise<Escalation> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof Escalation, `expected an Escalation, got ${e}`);
    return e;
  }
  throw new Error('expected an Escalation, the flow returned instead');
}

// ---- the tests -------------------------------------------------------------

describe('runFlow — the happy path', () => {
  it('drives cart → shipping → payment and stops at the goal', async () => {
    const d = new FakeDriver({ screens: [CART, ADDRESS_CONFIRM, SLOT, PAYMENT] });
    const r = await run(d);
    assert.equal(r.reached, true);
    assert.equal(r.verdict.state, 'payment_form');
    assert.deepEqual(
      d.performed.map((a) => (a.kind === 'click' ? a.label : a.kind)),
      ['Finalizar compra', 'Confirmar', 'Continuar'],
    );
  });

  it('never acts on the goal screen', async () => {
    const d = new FakeDriver({ screens: [PAYMENT] });
    const r = await run(d);
    assert.equal(r.reached, true);
    assert.equal(d.performed.length, 0, 'the payment form must not be touched by the loop');
  });

  it('never acts on a placed order, whatever the goal was', async () => {
    const d = new FakeDriver({ screens: [CONFIRMED] });
    const r = await run(d, 'payment_form');
    assert.equal(r.reached, true);
    assert.equal(r.verdict.state, 'confirmation');
    assert.equal(d.performed.length, 0, 're-submitting a placed order is the one mistake with no undo');
  });

  it('runs all the way to a confirmation when that is the goal', async () => {
    const d = new FakeDriver({ screens: [PAYMENT, PROCESSING, CONFIRMED] });
    const r = await run(d, 'confirmation');
    assert.equal(r.reached, true);
    assert.deepEqual(d.performed.map((a) => a.kind), ['fill_payment', 'wait']);
    assert.ok(d.slept > 0, 'it waits out the gateway rather than clicking again');
  });
});

describe('runFlow — order stops mattering', () => {
  it('reaches the goal whatever order the screens arrive in', async () => {
    const orders: Observation[][] = [
      [CART, ADDRESS_CONFIRM, SLOT, PAYMENT],
      [CART, SLOT, ADDRESS_CONFIRM, PAYMENT],
      [SLOT, CART, PAYMENT],
      [CART, PAYMENT],
    ];
    for (const screens of orders) {
      const r = await run(new FakeDriver({ screens }));
      assert.equal(r.reached, true, `failed for ${screens.length} screens`);
    }
  });

  it('absorbs interstitials wherever they are injected', async () => {
    const d = new FakeDriver({ screens: [COOKIES, CART, UPSELL, ADDRESS_CONFIRM, PAYMENT] });
    const r = await run(d);
    assert.equal(r.reached, true);
    assert.deepEqual(
      d.performed.map((a) => (a.kind === 'click' ? a.label : a.kind)),
      ['Aceptar', 'Finalizar compra', 'No, gracias', 'Confirmar'],
    );
  });

  it('dismisses an upsell without clicking the button that adds an item', async () => {
    const d = new FakeDriver({ screens: [UPSELL, PAYMENT] });
    await run(d);
    assert.equal(d.performed[0]?.kind === 'click' && d.performed[0].label, 'No, gracias');
  });

  it('absorbs the same screen appearing twice — handlers are idempotent', async () => {
    const d = new FakeDriver({ screens: [CART, CART, ADDRESS_CONFIRM, PAYMENT] });
    const r = await run(d);
    assert.equal(r.reached, true);
    assert.equal(d.performed.filter((a) => a.kind === 'click' && a.label === 'Finalizar compra').length, 2);
  });
});

describe('runFlow — stall detection', () => {
  it('escalates after exactly three non-advancing iterations', async () => {
    const d = new FakeDriver({ screens: [CART], stuck: true });
    const e = await expectEscalation(run(d));
    assert.equal(d.escalations[0]?.reason, 'stalled');
    assert.match(e.message, /stopped responding/);
    // Clicked once, retried twice, then stopped: the third unchanged
    // observation trips the counter before a fourth click is performed.
    assert.equal(d.performed.length, 3, 'it stops clicking rather than hammering the store');
  });

  it('does not count a screen that did change', async () => {
    const d = new FakeDriver({ screens: [CART, UPSELL, CART, ADDRESS_CONFIRM, PAYMENT] });
    assert.equal((await run(d)).reached, true);
  });

  it('is patient with a processing screen, which is meant to look unchanged', async () => {
    const d = new FakeDriver({ screens: [PROCESSING], stuck: true });
    const e = await expectEscalation(run(d, 'confirmation', { maxWaits: 5, maxSteps: 50 }));
    assert.equal(d.escalations[0]?.reason, 'stalled');
    assert.match(e.message, /Waited 5 times/);
    assert.equal(d.performed.length, 5, 'more patience than the three-stall rule would give');
    assert.ok(d.slept >= 5 * 2_000, 'and it actually slept between checks');
  });

  it('a processing screen that resolves is not a stall', async () => {
    const d = new FakeDriver({ screens: [PROCESSING, PROCESSING, PROCESSING, CONFIRMED] });
    const r = await run(d, 'confirmation', { maxWaits: 5 });
    assert.equal(r.reached, true);
  });
});

describe('runFlow — budgets', () => {
  it('enforces the step budget', async () => {
    const d = new FakeDriver({ screens: [CART, UPSELL, CART, UPSELL, CART, UPSELL, CART] });
    const e = await expectEscalation(run(d, 'payment_form', { maxSteps: 4 }));
    assert.equal(d.escalations[0]?.reason, 'budget_exhausted');
    assert.match(e.message, /full budget of 4 steps/);
  });

  it('enforces the time budget even when steps remain', async () => {
    const d = new FakeDriver({ screens: [CART, UPSELL, CART, UPSELL, CART], tickMs: 30_000 });
    const e = await expectEscalation(run(d, 'payment_form', { maxMs: 60_000 }));
    assert.equal(d.escalations[0]?.reason, 'budget_exhausted');
    assert.match(e.message, /Gave up after/);
  });
});

describe('runFlow — terminal states', () => {
  it('stops on a decline and reports failure without clicking anything', async () => {
    const d = new FakeDriver({ screens: [DECLINED] });
    const r = await run(d, 'confirmation');
    assert.equal(r.reached, false);
    assert.equal(r.verdict.state, 'declined');
    assert.equal(d.performed.length, 0);
    assert.equal(d.escalations.length, 0, 'a decline is an answer, not an escalation');
  });

  it('stops on an empty cart', async () => {
    const d = new FakeDriver({ screens: [{ pageState: CART.pageState, orderForm: of({ items: [] }) }] });
    const r = await run(d);
    assert.equal(r.reached, false);
    assert.equal(r.verdict.state, 'empty_cart');
  });
});

describe('runFlow — escalation', () => {
  it('escalates an unrecognised screen instead of clicking something', async () => {
    const d = new FakeDriver({ screens: [MYSTERY] });
    await expectEscalation(run(d));
    assert.equal(d.escalations[0]?.reason, 'unknown_screen');
    assert.equal(d.performed.length, 0);
  });

  it('escalates a changed cart as a store problem — the user decides', async () => {
    const d = new FakeDriver({ screens: [OUT_OF_STOCK] });
    const e = await expectEscalation(run(d));
    assert.equal(d.escalations[0]?.reason, 'store_problem');
    assert.match(e.message, /sin stock/);
    assert.equal(d.performed.length, 0, 'a "Finalizar compra" button was right there and was not clicked');
  });

  it('escalates a recognised screen with no usable control as no_action', async () => {
    const noButton: Observation = {
      pageState: emptyPageState({ url: 'https://d.test/checkout/#/cart', buttons: ['Vaciar carrito'] }),
      orderForm: of(),
    };
    const d = new FakeDriver({ screens: [noButton] });
    await expectEscalation(run(d));
    assert.equal(d.escalations[0]?.reason, 'no_action');
  });

  it('refuses to fill an address it was never given', async () => {
    const needsAddress: Observation = {
      pageState: emptyPageState({ url: 'https://d.test/checkout/#/shipping' }),
      orderForm: of({ shippingData: { address: undefined, logisticsInfo: [] } } as Partial<VtexOrderForm>),
    };
    const d = new FakeDriver({ screens: [needsAddress] });
    await expectEscalation(run(d, 'payment_form', { hasAddress: false }));
    assert.equal(d.escalations[0]?.verdict?.state, 'address');
  });
});

describe('runFlow — Layer 3 is optional and fails closed', () => {
  it('uses Jev only for what Layers 1 and 2 could not name', async () => {
    const asked: string[] = [];
    const d = new FakeDriver({
      screens: [CART, MYSTERY, PAYMENT],
      jev: async (ps) => {
        asked.push(ps.url);
        return { state: 'interstitial', confidence: 0.9, layer: 'jev', why: 'a survey popup', modalId: 'unknown' };
      },
    });
    const e = await expectEscalation(run(d));
    // Jev named it an interstitial, but no registry entry means no dismiss
    // control — so the loop still stops rather than clicking "Responder".
    assert.deepEqual(asked, [MYSTERY.pageState.url], 'the known screens never reached the network');
    assert.match(e.message, /no dismiss control/);
  });

  it('treats a Jev outage as an unknown screen, never as a guess', async () => {
    const d = new FakeDriver({
      screens: [MYSTERY],
      jev: async () => {
        throw new Error('ETIMEDOUT');
      },
    });
    await expectEscalation(run(d));
    assert.equal(d.escalations[0]?.reason, 'unknown_screen');
    assert.equal(d.performed.length, 0);
  });

  it('carries on through a screen only Jev could name', async () => {
    const jevSlot: Observation = {
      pageState: emptyPageState({
        url: 'https://d.test/checkout/#/shipping',
        buttons: ['Continuar'],
        textLength: 650,
      }),
      orderForm: undefined,
    };
    const d = new FakeDriver({
      screens: [jevSlot, PAYMENT],
      jev: async () => ({ state: 'shipping_slot', confidence: 0.88, layer: 'jev', why: 'slot picker' }),
    });
    const r = await run(d);
    assert.equal(r.reached, true);
    assert.equal(d.performed[0]?.kind === 'click' && d.performed[0].label, 'Continuar');
  });
});

describe('runFlow — the record it leaves', () => {
  it('reports every step it took, for the summary shown to the user', async () => {
    const d = new FakeDriver({ screens: [CART, ADDRESS_CONFIRM, PAYMENT] });
    const r = await run(d);
    assert.equal(r.steps, 2);
    assert.deepEqual(r.history.map((h) => h.verdict.state), ['cart', 'address_confirm']);
    assert.deepEqual(r.history.map((h) => h.step), [1, 2]);
    assert.equal(r.goal, 'payment_form');
    assert.equal(r.orderForm?.orderFormId, 'ABC');
  });
});
