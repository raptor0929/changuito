import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  advance,
  atLeast,
  checkApproval,
  checkTransition,
  describeDraft,
  getDraft,
  invalidateApprovals,
  OrderStateError,
  REQUIRES,
  resetOrder,
  requireStage,
  setDraft,
  STAGES,
  type OrderDraft,
} from '../order.js';

const at = (stage: OrderDraft['stage'], over: Partial<OrderDraft> = {}): OrderDraft => ({ stage, ...over });

const READY = {
  status: 'ready' as const,
  requiredUsdCents: 2_350,
  bareUsdCents: 2_040,
  arsTotal: 2_040_000,
  arsPerUsd: 1_000,
  buffer: 0.15,
  settledUsdCents: 5_000,
  pendingUsdCents: 0,
  remainingUsdCents: 2_650,
  raisedToCardMinimum: false,
};

beforeEach(() => resetOrder());

describe('the stage ladder', () => {
  it('is ordered, and a later stage implies every earlier one', () => {
    assert.equal(atLeast('reviewed', 'cart_built'), true);
    assert.equal(atLeast('cart_built', 'reviewed'), false);
    assert.equal(atLeast('linked', 'linked'), true);
  });

  it('never moves backwards', () => {
    const d = at('reviewed');
    assert.equal(advance(d, 'cart_built').stage, 'reviewed');
    assert.equal(advance(d, 'funds_checked').stage, 'funds_checked');
  });

  it('lists every stage exactly once', () => {
    assert.equal(new Set(STAGES).size, STAGES.length);
  });
});

describe('RULE: no tool can skip an approval gate', () => {
  it('rejects every gated tool from the starting stage, naming what to run', () => {
    for (const [tool, needed] of Object.entries(REQUIRES)) {
      assert.throws(
        () => checkTransition(tool, at('searching')),
        (e: unknown) => {
          assert.ok(e instanceof OrderStateError, tool);
          assert.equal(e.needed, needed);
          assert.match(e.message, /Run \w+ before this/);
          return true;
        },
        tool,
      );
    }
  });

  it('rejects EVERY illegal transition, not just the obvious ones', () => {
    const illegal: Array<[string, OrderDraft['stage']]> = [];
    for (const [tool, needed] of Object.entries(REQUIRES)) {
      for (const stage of STAGES) {
        if (atLeast(stage, needed) || stage === 'order_placed') continue;
        illegal.push([tool, stage]);
        assert.throws(() => checkTransition(tool, at(stage)), OrderStateError, `${tool} from ${stage}`);
      }
    }
    assert.ok(illegal.length >= 10, `covered ${illegal.length} illegal combinations`);
  });

  it('allows each gated tool once its stage is reached', () => {
    for (const [tool, needed] of Object.entries(REQUIRES)) {
      checkTransition(tool, at(needed));
    }
  });

  it('lets ungated tools run from anywhere — replenishing is independent of any purchase', () => {
    for (const stage of STAGES) {
      checkTransition('replenish_wallet', at(stage));
      checkTransition('link_marketplace_account', at(stage));
      checkTransition('search_products', at(stage));
    }
  });

  it('refuses to touch an order the store has already accepted', () => {
    assert.throws(() => checkTransition('approve_payment', at('order_placed')), /already been placed/);
    assert.throws(() => checkTransition('build_cart', at('order_placed')), /already been placed/);
    // Looking is still allowed.
    checkTransition('review_order', at('order_placed'));
  });
});

describe('the approval gate', () => {
  const draft = at('funds_checked', { totalCentavos: 2_040_000, plan: READY });

  it('accepts the exact total', () => {
    checkApproval(draft, 2_040_000);
  });

  it('rejects a total that is off by one centavo', () => {
    assert.throws(() => checkApproval(draft, 2_040_001), /Nothing was paid/);
  });

  it('rejects an approval when nothing has been reviewed', () => {
    assert.throws(() => checkApproval(at('funds_checked'), 100), /Run review_order first/);
  });

  it('refuses to pay when the funding check did not say ready', () => {
    const short = at('funds_checked', {
      totalCentavos: 2_040_000,
      plan: { ...READY, status: 'short', shortfallUsdCents: 500 } as never,
    });
    assert.throws(() => checkApproval(short, 2_040_000), /replenish_wallet/);
  });

  it('refuses when no funding check has been run at all', () => {
    assert.throws(
      () => checkApproval(at('funds_checked', { totalCentavos: 2_040_000 }), 2_040_000),
      /not 'ready'/,
    );
  });
});

describe('changing the cart invalidates what was approved about it', () => {
  it('drops the reviewed total and the funding plan', () => {
    const after = invalidateApprovals(at('funds_checked', { totalCentavos: 2_040_000, plan: READY }));
    assert.equal(after.stage, 'cart_built');
    assert.equal(after.totalCentavos, undefined);
    assert.equal(after.plan, undefined);
  });

  it('leaves an un-reviewed draft alone', () => {
    const before = at('cart_built', { orderFormId: 'ABC' });
    assert.deepEqual(invalidateApprovals(before), before);
  });

  it('means a user can never approve one basket and pay for another', () => {
    const changed = invalidateApprovals(at('funds_checked', { totalCentavos: 2_040_000, plan: READY }));
    assert.throws(() => checkTransition('approve_payment', changed), /needs 'funds_checked'/);
  });
});

describe('the live draft', () => {
  it('starts at searching and resets cleanly', () => {
    assert.equal(getDraft().stage, 'searching');
    setDraft(at('reviewed', { totalCentavos: 1 }));
    assert.equal(resetOrder().stage, 'searching');
    assert.equal(getDraft().totalCentavos, undefined);
  });

  it('requireStage guards against the live draft', () => {
    assert.throws(() => requireStage('approve_payment'), OrderStateError);
    setDraft(at('funds_checked'));
    assert.equal(requireStage('approve_payment').stage, 'funds_checked');
  });
});

describe('describeDraft', () => {
  it('summarises without inventing anything it does not have', () => {
    const text = describeDraft(
      at('reviewed', {
        orderFormId: 'ABC',
        totalCentavos: 2_040_000,
        address: { street: 'Av Corrientes', number: '1234', postalCode: '1043' },
        plan: READY,
      }),
    );
    assert.match(text, /Stage: reviewed/);
    assert.match(text, /Av Corrientes 1234, CP 1043/);
    assert.match(text, /Funding: ready/);
    assert.equal(/Order:/.test(text), false);
  });
});
