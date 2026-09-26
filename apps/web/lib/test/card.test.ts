import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CARD_MAX_CENTS, CARD_MIN_CENTS } from '@changuito/mcp/pay';

import { canIssueCard, centsFromAmount, refuseFunding, timeoutFetch } from '../card.ts';

describe('what a deposit is worth', () => {
  it('reads a ledger amount as integer cents', () => {
    assert.equal(centsFromAmount('1'), 100);
    assert.equal(centsFromAmount('12.34'), 1234);
    assert.equal(centsFromAmount('0.07'), 7);
  });

  it('truncates past two decimals rather than rounding up', () => {
    // A ledger amount has seven. Rounding up would fund a card with a cent
    // nobody sent, and the whole point of this figure is that it came from
    // the ledger rather than from arithmetic of ours.
    assert.equal(centsFromAmount('4.6600000'), 466);
    assert.equal(centsFromAmount('4.669'), 466);
    assert.equal(centsFromAmount('4.6'), 460);
  });

  it('RULE: does the arithmetic on the string, not on a float', () => {
    // 0.1 + 0.2 is the reason deposit-watch.ts counts stroops. The same
    // reason applies harder here, because this number buys something.
    assert.equal(centsFromAmount('0.29'), 29);
    assert.equal(centsFromAmount('8.11'), 811);
    assert.equal(centsFromAmount('1234567.89'), 123456789);
  });

  it('refuses anything that is not a plain positive amount', () => {
    for (const bad of ['', '-1', '1.2.3', 'abc', '1e3', ' 1', '.5', '1.12345678']) {
      assert.equal(centsFromAmount(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe('the funding bounds', () => {
  it('holds the provider to its own documented limits', () => {
    assert.equal(refuseFunding(CARD_MIN_CENTS), null);
    assert.equal(refuseFunding(CARD_MAX_CENTS), null);
    assert.equal(refuseFunding(CARD_MIN_CENTS - 1), 'too-small');
    assert.equal(refuseFunding(CARD_MAX_CENTS + 1), 'too-large');
  });

  it('RULE: a dust deposit is refused rather than rounded up to the minimum', () => {
    // Funding more than arrived would spend the treasury's money on somebody
    // else's basket, one cent at a time.
    assert.equal(refuseFunding(1), 'too-small');
  });
});

describe('whether cards exist in this deployment', () => {
  it('is false with no key, so the button is never rendered', () => {
    const env = (v?: string) => ({ NODE_ENV: 'test', VYRION_API_KEY: v }) as NodeJS.ProcessEnv;
    assert.equal(canIssueCard(env()), false);
    assert.equal(canIssueCard(env('   ')), false);
    assert.equal(canIssueCard(env('sk_test_x')), true);
  });
});

describe('the fetch wrapper', () => {
  it('retries a 502 and returns the eventual success', async () => {
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return new Response('{}', { status: calls < 3 ? 502 : 200 });
    }) as unknown as typeof fetch;
    const res = await timeoutFetch(inner)('https://example.test/');
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  });

  it('RULE: does not retry a 4xx — that is an answer, not a failure', async () => {
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return new Response('{}', { status: 409 });
    }) as unknown as typeof fetch;
    const res = await timeoutFetch(inner)('https://example.test/');
    assert.equal(res.status, 409);
    assert.equal(calls, 1);
  });

  it('gives up after the last attempt and rethrows', async () => {
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await assert.rejects(() => timeoutFetch(inner)('https://example.test/'), /socket hang up/);
    assert.equal(calls, 3);
  });
});
