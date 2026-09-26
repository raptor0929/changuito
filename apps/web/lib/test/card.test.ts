import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CARD_MAX_CENTS, CARD_MIN_CENTS } from '@changuito/mcp/pay';

import {
  canIssueCard,
  centsFromAmount,
  claimDeposit,
  depositorOf,
  heldCard,
  rememberDepositor,
  refuseFunding,
  timeoutFetch,
} from '../card.ts';

const WALLET = `G${'A'.repeat(55)}`;

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

describe('the deposit record, with no database configured', () => {
  // These run against the in-process fallback, because DATABASE_URL is not set
  // in the test environment and deliberately is not: a unit suite that needs a
  // live Postgres is a unit suite that stops being run. The fallback is a real
  // path — it is what a fresh clone uses — so proving it holds the once-only
  // rule is worth doing on its own.
  //
  // What this cannot prove is that the SQL says the same thing. That is
  // `npm run db:invariants`, which exercises the constraints against the real
  // database inside a transaction it always rolls back.

  it('remembers who opened a memo, and tells the truth when nobody did', async () => {
    const memo = 'chg-remember-1';
    assert.equal(await depositorOf('testnet', memo), undefined);
    await rememberDepositor('testnet', memo, { address: WALLET, amountCents: 2450 });
    assert.equal(await depositorOf('testnet', memo), WALLET);
  });

  it('records no address in open mode rather than recording a guess', async () => {
    // The deposit route omits `address` when realModeMode() is 'open', where
    // nothing was proven. undefined must mean "nobody was checked" — if it
    // returned the claimed address, POST /api/card would later check a value
    // the caller supplied against itself.
    const memo = 'chg-remember-open';
    await rememberDepositor('testnet', memo, { amountCents: 2450 });
    assert.equal(await depositorOf('testnet', memo), undefined);
  });

  it('RULE: a deposit buys exactly one card', async () => {
    const memo = 'chg-claim-1';
    assert.equal(await heldCard('testnet', memo), undefined);

    const first = await claimDeposit('testnet', memo, 'card_first', 2450);
    assert.deepEqual(first, { claimed: true });

    const second = await claimDeposit('testnet', memo, 'card_second', 2450);
    assert.equal(second.claimed, false, 'a second claim on the same memo must lose');
    assert.equal(second.existing, 'card_first', 'the loser must be told whose card won');

    assert.equal(await heldCard('testnet', memo), 'card_first');
  });

  it('keeps testnet and mainnet claims apart', async () => {
    const memo = 'chg-claim-net';
    await claimDeposit('testnet', memo, 'card_testnet', 2450);
    const main = await claimDeposit('mainnet', memo, 'card_mainnet', 2450);
    assert.equal(main.claimed, true, 'the same memo on another network is another deposit');
    assert.equal(await heldCard('testnet', memo), 'card_testnet');
    assert.equal(await heldCard('mainnet', memo), 'card_mainnet');
  });

  it('heldCard never claims', async () => {
    const memo = 'chg-claim-readonly';
    assert.equal(await heldCard('testnet', memo), undefined);
    assert.equal(await heldCard('testnet', memo), undefined);
    // Still claimable afterwards — a read must not have latched anything.
    assert.equal((await claimDeposit('testnet', memo, 'card_x', 2450)).claimed, true);
  });
});
