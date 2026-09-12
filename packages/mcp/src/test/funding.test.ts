import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideFunding, explainFunding, type FundingPlan } from '../pay/funding.js';
import { CARD_MAX_CENTS, CARD_MIN_CENTS } from '../pay/vyrion.js';

const RATE = 1450;
const base = { arsPerUsd: RATE, settledUsdCents: 0, pendingUsdCents: 0 };

/** 18.430,50 ARS -> 12.72 bare -> 14.62 with the 15% buffer. */
const ORDER_ARS = 1_843_050;
const ORDER_REQUIRED = 1462;

describe('decideFunding — the happy path', () => {
  it('is ready when settled balance exactly equals the requirement', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: ORDER_REQUIRED });
    assert.equal(p.status, 'ready');
    assert.equal(p.requiredUsdCents, ORDER_REQUIRED);
    assert.equal(p.status === 'ready' && p.remainingUsdCents, 0);
  });

  it('is ready with room to spare', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 14_250 });
    assert.equal(p.status, 'ready');
    assert.equal(p.status === 'ready' && p.remainingUsdCents, 14_250 - ORDER_REQUIRED);
  });

  it('reports the bare amount alongside the buffered one', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 100_000 });
    assert.equal(p.bareUsdCents, 1272);
    assert.ok(p.requiredUsdCents > p.bareUsdCents, 'buffer must increase the funding');
  });
});

describe('decideFunding — short', () => {
  it('is short by exactly one cent when one cent short', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: ORDER_REQUIRED - 1 });
    assert.equal(p.status, 'short');
    assert.equal(p.status === 'short' && p.shortfallUsdCents, 1);
  });

  it('is short by the whole amount on an empty wallet', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 0 });
    assert.equal(p.status, 'short');
    assert.equal(p.status === 'short' && p.shortfallUsdCents, ORDER_REQUIRED);
  });
});

describe('THE INVARIANT: pending deposits are never spendable', () => {
  it('stays short even when pending would more than cover it', () => {
    const p = decideFunding({
      ...base,
      arsTotal: ORDER_ARS,
      settledUsdCents: 0,
      pendingUsdCents: 1_000_000,
    });
    assert.equal(p.status, 'short', 'unconfirmed crypto is not money we have');
    assert.equal(p.status === 'short' && p.shortfallUsdCents, ORDER_REQUIRED);
  });

  it('carries pending through for display without letting it change the outcome', () => {
    const withPending = decideFunding({
      ...base,
      arsTotal: ORDER_ARS,
      settledUsdCents: ORDER_REQUIRED,
      pendingUsdCents: 50_000,
    });
    const without = decideFunding({
      ...base,
      arsTotal: ORDER_ARS,
      settledUsdCents: ORDER_REQUIRED,
    });
    assert.equal(withPending.status, without.status);
    assert.equal(withPending.requiredUsdCents, without.requiredUsdCents);
    assert.equal(withPending.pendingUsdCents, 50_000);
  });

  it('shows pending in the explanation, labelled as not counted', () => {
    const p = decideFunding({
      ...base,
      arsTotal: ORDER_ARS,
      settledUsdCents: 0,
      pendingUsdCents: 50_000,
    });
    const text = explainFunding(p);
    assert.match(text, /Pending deposits/);
    assert.match(text, /not counted/);
  });
});

describe('decideFunding — Vyrion card bounds', () => {
  it('raises a tiny order up to the $1 card minimum instead of failing', () => {
    // 500 centavos == 5 pesos; a fraction of a cent.
    const p = decideFunding({ ...base, arsTotal: 500, settledUsdCents: 10_000 });
    assert.equal(p.status, 'ready');
    assert.equal(p.requiredUsdCents, CARD_MIN_CENTS);
    assert.equal(p.status === 'ready' && p.raisedToCardMinimum, true);
    assert.match(explainFunding(p), /card minimum/);
  });

  it('does not claim to have raised anything on a normal order', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 100_000 });
    assert.equal(p.status === 'ready' && p.raisedToCardMinimum, false);
  });

  it('refuses an order above the $5,000 card maximum', () => {
    // 5000 USD at 1450, before the buffer, is 7.25m pesos. Go well past it.
    const p = decideFunding({ ...base, arsTotal: 1_000_000_000, settledUsdCents: 10_000_000 });
    assert.equal(p.status, 'over_card_limit');
    assert.ok(p.requiredUsdCents > CARD_MAX_CENTS);
    assert.match(explainFunding(p), /Split the order/);
  });

  it('refuses over the limit even with a rich wallet', () => {
    const p = decideFunding({
      ...base,
      arsTotal: 1_000_000_000,
      settledUsdCents: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(p.status, 'over_card_limit');
  });
});

describe('decideFunding — degenerate input', () => {
  it('reports a zero cart rather than trying to fund a card with nothing', () => {
    const p = decideFunding({ ...base, arsTotal: 0, settledUsdCents: 10_000 });
    assert.equal(p.status, 'zero_total');
    assert.match(explainFunding(p), /total is zero/);
  });

  it('is pure — the same input always gives the same answer', () => {
    const input = { ...base, arsTotal: ORDER_ARS, settledUsdCents: 5000 };
    assert.deepEqual(decideFunding(input), decideFunding(input));
  });

  it('propagates an insane rate rather than sizing a funding from it', () => {
    assert.throws(
      () => decideFunding({ ...base, arsPerUsd: 1, arsTotal: ORDER_ARS, settledUsdCents: 1 }),
      /outside the sane range/,
    );
  });
});

describe('explainFunding', () => {
  const ready = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 100_000 });

  it('names the buffer explicitly — no silent markup', () => {
    const t = explainFunding(ready);
    assert.match(t, /15% FX buffer/);
    assert.match(t, /buffer is not spent/);
  });

  it('shows both currencies', () => {
    const t = explainFunding(ready);
    assert.match(t, /\$/);
    assert.match(t, /Order total/);
    assert.match(t, /Rate:/);
  });

  it('tells the user what to do when short', () => {
    const p = decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 0 });
    assert.match(explainFunding(p), /replenish_wallet/);
  });

  it('handles every status without throwing', () => {
    const plans: FundingPlan[] = [
      decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 100_000 }),
      decideFunding({ ...base, arsTotal: ORDER_ARS, settledUsdCents: 0 }),
      decideFunding({ ...base, arsTotal: 1_000_000_000, settledUsdCents: 0 }),
      decideFunding({ ...base, arsTotal: 0, settledUsdCents: 0 }),
    ];
    for (const p of plans) assert.ok(explainFunding(p).length > 0, p.status);
  });
});
