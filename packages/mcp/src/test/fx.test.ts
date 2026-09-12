import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_BUFFER,
  RATE_MAX,
  RATE_MIN,
  arsToUsdCents,
  assertSaneRate,
  clearFxCache,
  getArsPerUsd,
  usdCentsToArs,
} from '../pay/fx.js';

/** A plausible 2026 official rate. Chosen once so the arithmetic below is readable. */
const RATE = 1450;

afterEach(() => {
  clearFxCache();
  delete process.env.ARS_PER_USD;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('assertSaneRate — the guard on the most dangerous number here', () => {
  it('accepts a plausible peso rate', () => {
    assert.equal(assertSaneRate(RATE, 'test'), RATE);
    assert.equal(assertSaneRate(RATE_MIN, 'test'), RATE_MIN);
    assert.equal(assertSaneRate(RATE_MAX, 'test'), RATE_MAX);
  });

  it('refuses a rate of 1, which would load 1450x too much onto the card', () => {
    assert.throws(() => assertSaneRate(1, 'test'), /outside the sane range/);
  });

  it('refuses zero, negative, NaN and Infinity', () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      assert.throws(() => assertSaneRate(bad, 'test'), /ARS rate|sane range/, String(bad));
    }
  });

  it('refuses an absurdly large rate', () => {
    assert.throws(() => assertSaneRate(1e9, 'test'), /outside the sane range/);
  });
});

describe('arsToUsdCents', () => {
  it('converts with the default buffer', () => {
    // 18430.50 ARS / 1450 = 12.7107 USD; x1.15 = 14.617 -> ceil -> 1462 cents
    assert.equal(arsToUsdCents(1_843_050, RATE), 1462);
  });

  it('converts with no buffer', () => {
    // 12.7107 USD -> ceil -> 1272 cents
    assert.equal(arsToUsdCents(1_843_050, RATE, 0), 1272);
  });

  it('always rounds UP, so the card is never a cent short at the till', () => {
    // Any amount that lands mid-cent must go up, never down.
    const cents = arsToUsdCents(100, RATE, 0); // 1 peso, a fraction of a cent
    assert.equal(cents, 1);
  });

  it('is monotonic in the total', () => {
    let prev = -1;
    for (const ars of [100, 10_000, 1_000_000, 5_000_000]) {
      const c = arsToUsdCents(ars, RATE);
      assert.ok(c > prev, `${ars} -> ${c} should exceed ${prev}`);
      prev = c;
    }
  });

  it('applies the buffer proportionally', () => {
    const bare = arsToUsdCents(10_000_000, RATE, 0);
    const buffered = arsToUsdCents(10_000_000, RATE, 0.15);
    assert.ok(Math.abs(buffered / bare - 1.15) < 0.001);
  });

  it('returns zero for a zero total', () => {
    assert.equal(arsToUsdCents(0, RATE), 0);
  });

  it('rejects a negative total and an out-of-range buffer', () => {
    assert.throws(() => arsToUsdCents(-1, RATE), /Invalid ARS amount/);
    assert.throws(() => arsToUsdCents(1000, RATE, -0.1), /between 0 and 1/);
    assert.throws(() => arsToUsdCents(1000, RATE, 1.5), /between 0 and 1/);
  });

  it('refuses to convert at an insane rate', () => {
    assert.throws(() => arsToUsdCents(1_000_000, 1), /outside the sane range/);
  });

  it('round-trips to within one USD cent of the original pesos', () => {
    // Converting pesos -> whole USD cents -> pesos cannot be exact: the
    // granularity of the result is one US cent, which at this rate is about
    // 14.50 ARS. So the bound is "one cent's worth of pesos", not "a few
    // centavos" — and because we always round UP, the error is one-sided.
    const ars = 1_843_050;
    const back = usdCentsToArs(arsToUsdCents(ars, RATE, 0), RATE);
    const oneUsdCentInCentavos = RATE * 100;
    assert.ok(back >= ars, 'rounding up must never come back short');
    assert.ok(back - ars < oneUsdCentInCentavos, `${back} vs ${ars}`);
  });
});

describe('getArsPerUsd', () => {
  it('prefers an explicit override and never touches the network for one', async () => {
    const r = await getArsPerUsd({ override: RATE, fetchImpl: () => assert.fail('no fetch') });
    assert.equal(r.arsPerUsd, RATE);
    assert.equal(r.source, 'override');
  });

  it('ignores ARS_PER_USD in the environment — config owns env, this module does not', async () => {
    // The pinned rate reaches here as cfg.fx.override. Reading the variable in
    // two places is how one of them ends up stale.
    process.env.ARS_PER_USD = '999';
    const r = await getArsPerUsd({ fetchImpl: () => jsonResponse({ rates: { ARS: RATE } }) as never });
    assert.equal(r.arsPerUsd, RATE);
    assert.notEqual(r.source, 'env');
  });

  it('still range-checks an override', async () => {
    await assert.rejects(getArsPerUsd({ override: 2 }), /outside the sane range/);
  });

  it('fetches and caches, so a run does not hammer the feed', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ rates: { ARS: RATE } });
    }) as unknown as typeof fetch;

    const a = await getArsPerUsd({ fetchImpl });
    const b = await getArsPerUsd({ fetchImpl });
    assert.equal(a.arsPerUsd, RATE);
    assert.equal(b.arsPerUsd, RATE);
    assert.equal(calls, 1, 'second call must come from cache');
  });

  it('re-fetches once the cache has aged out', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ rates: { ARS: RATE } });
    }) as unknown as typeof fetch;

    let t = 1_000_000;
    await getArsPerUsd({ fetchImpl, now: () => t });
    t += 2 * 60 * 60 * 1000;
    await getArsPerUsd({ fetchImpl, now: () => t });
    assert.equal(calls, 2);
  });

  it('fails loudly on an HTTP error rather than guessing a rate', async () => {
    const fetchImpl = (async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await assert.rejects(() => getArsPerUsd({ fetchImpl }), /HTTP 503/);
  });

  it('fails loudly when the feed has no ARS rate', async () => {
    const fetchImpl = (async () => jsonResponse({ rates: { EUR: 0.9 } })) as unknown as typeof fetch;
    await assert.rejects(() => getArsPerUsd({ fetchImpl }), /did not include an ARS rate/);
  });

  it('refuses a fetched rate that fails the sanity check', async () => {
    const fetchImpl = (async () => jsonResponse({ rates: { ARS: 1 } })) as unknown as typeof fetch;
    await assert.rejects(() => getArsPerUsd({ fetchImpl }), /outside the sane range/);
  });

  it('does not cache a rejected rate', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ rates: { ARS: calls === 1 ? 1 : RATE } });
    }) as unknown as typeof fetch;

    await assert.rejects(() => getArsPerUsd({ fetchImpl }));
    const ok = await getArsPerUsd({ fetchImpl });
    assert.equal(ok.arsPerUsd, RATE);
  });
});

describe('DEFAULT_BUFFER', () => {
  it('is 15%, and the plan says so', () => {
    assert.equal(DEFAULT_BUFFER, 0.15);
  });
});
