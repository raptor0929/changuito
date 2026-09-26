import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { POST } from '../../app/api/card/terminate/route.ts';
import { mintMemo } from '../deposit.ts';

/**
 * Giving back the card that dies with the basket — and, much more
 * importantly, not giving back the one that does not.
 *
 * This route used to terminate whatever card the order held, and in
 * production that card is the customer's: one per wallet, topped up by every
 * deposit, and destroyed by a checkout dialog closing. So the suite is mostly
 * about the refusals, and the shape of the refusals is what it pins.
 *
 * What is *not* here is a successful termination, which needs Vyrion. The
 * unit suite has no card API and no Postgres, on purpose — lib/card.ts's
 * header says why — so every case below stops before either.
 */

const MEMO = mintMemo();
/** Never dialled successfully: reaching it is the point of the last case. */
const UNREACHABLE_DB = 'postgres://user:pw@db.invalid:6543/postgres';

const TOUCHED = ['DATABASE_URL', 'VYRION_API_KEY'] as const;
const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const withEnv = async (vars: Record<string, string>, run: () => Promise<void>) => {
  for (const k of TOUCHED) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    await run();
  } finally {
    for (const k of TOUCHED) delete process.env[k];
  }
};

const ask = (body: unknown) =>
  POST(
    new Request('https://changuito.test/api/card/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('giving a card back', () => {
  it('refuses a body that is not JSON', async () => {
    const res = await ask('{');
    assert.equal(res.status, 400);
  });

  it('refuses anything that is not a código', async () => {
    for (const memo of ['', 'chg', MEMO + 'x', MEMO.slice(0, -1), 42, null, undefined]) {
      const res = await ask({ memo, network: 'testnet' });
      assert.equal(res.status, 400, `accepted ${JSON.stringify(memo)}`);
    }
  });

  it('says there is nothing to give back where cards are not issued at all', async () => {
    await withEnv({}, async () => {
      const res = await ask({ memo: MEMO, network: 'testnet' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.terminated, false);
      // Not `kept`: nothing was declined here, there is simply no card API in
      // this deployment. The two read differently on purpose — one is a
      // refusal and the other is an absence.
      assert.equal(body.kept, undefined);
    });
  });

  it('RULE: a database it cannot reach never costs a card', async () => {
    // The fail-closed rule, and the reason the owner lookup is not wrapped in
    // a `.catch(() => undefined)`. A lookup that reached nothing would
    // otherwise read as "no owner", `keepsOneCard` would answer false, and a
    // brief Postgres outage would destroy the card a customer keeps every
    // time somebody closed a checkout dialog.
    await withEnv({ DATABASE_URL: UNREACHABLE_DB, VYRION_API_KEY: 'vy_test_not_used' }, async () => {
      const res = await ask({ memo: MEMO, network: 'mainnet' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.terminated, false);
      assert.equal(body.kept, true, 'the route decided it could destroy a card it could not identify');
    });
  });

  it('RULE: preview is not special-cased into a shortcut past the same check', async () => {
    // Testnet reaches the very same lookup. `keepsOneCard` is what makes the
    // decision, not the network read off the body — an unknown network must
    // not become a way to ask for a termination on softer terms.
    await withEnv({ DATABASE_URL: UNREACHABLE_DB, VYRION_API_KEY: 'vy_test_not_used' }, async () => {
      for (const network of ['testnet', undefined, 'MAINNET', 'futurenet', 7]) {
        const res = await ask({ memo: MEMO, network });
        const body = await res.json();
        assert.equal(body.kept, true, `network ${JSON.stringify(network)} skipped the check`);
      }
    });
  });

  it('never caches the answer', async () => {
    await withEnv({}, async () => {
      const res = await ask({ memo: MEMO, network: 'testnet' });
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    });
  });
});
