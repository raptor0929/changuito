import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { POST } from '../../app/api/order/done/route.ts';
import { mintMemo } from '../deposit.ts';

/**
 * Closing an order, which is the one status the browser's word decides.
 *
 * The whole point of the route is that it can do almost nothing, so most of
 * this suite is about what it refuses to touch. The write itself needs a live
 * Postgres — the unit suite runs with none, on purpose, see lib/card.ts's
 * header — and the `paid`/`carded` → `done` transition is pinned against the
 * real database by `npm run db:invariants`.
 *
 * `DATABASE_URL` here is a value that is never dialled: every case below is
 * either refused before the query or short-circuited by the mode.
 */

const MEMO = mintMemo();
const UNUSED_DB = 'postgres://user:pw@db.invalid:6543/postgres';

const saved = process.env.DATABASE_URL;
after(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

const withDb = async (url: string | undefined, run: () => Promise<void>) => {
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  try {
    await run();
  } finally {
    delete process.env.DATABASE_URL;
  }
};

const ask = (body: unknown) =>
  POST(
    new Request('https://changuito.test/api/order/done', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('marking a shop finished', () => {
  it('refuses a body that is not JSON', async () => {
    const res = await ask('{');
    assert.equal(res.status, 400);
  });

  it('refuses anything that is not a código', async () => {
    // Same validator the deposit and card routes use. A memo is the order's
    // name everywhere, and a route that accepted a loose string here would be
    // the one place the shape is not checked.
    for (const memo of ['', 'chg', MEMO + 'x', MEMO.slice(0, -1), 42, null, undefined, { memo: MEMO }]) {
      const res = await ask({ memo, network: 'mainnet' });
      assert.equal(res.status, 400, `accepted ${JSON.stringify(memo)}`);
    }
  });

  it('RULE: preview answers yes without touching a database', async () => {
    // There is no row. "Closed" and "there was never anything to close" are
    // the same state, and the browser calls this in both modes because
    // `settle()` does not know which one it is in. The URL below is not
    // dialable, so a 200 here is proof the query did not run.
    await withDb(UNUSED_DB, async () => {
      const res = await ask({ memo: MEMO, network: 'testnet' });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    });
  });

  it('RULE: an unknown network is preview, not production', async () => {
    // `networkFrom` falls back to DEFAULT_NETWORK, which is testnet. A route
    // that defaulted the other way would let a typo write to the real record.
    await withDb(UNUSED_DB, async () => {
      for (const network of [undefined, '', 'MAINNET', 'futurenet', 7]) {
        const res = await ask({ memo: MEMO, network });
        assert.equal(res.status, 200, `${JSON.stringify(network)} did not read as preview`);
      }
    });
  });

  it('RULE: production with no database is a no-op, not a failure', async () => {
    // A fresh clone has no DATABASE_URL and the checkout still ends. Nothing
    // is waiting for this answer, so an error would be reporting a failure
    // that did not happen.
    await withDb(undefined, async () => {
      const res = await ask({ memo: MEMO, network: 'mainnet' });
      assert.equal(res.status, 200);
    });
  });

  it('RULE: the answer never says whether the código existed', async () => {
    // Every reply is the same object. Telling the caller which memos closed
    // something would make this an oracle for "is that a real código", which
    // is the one secret the memo carries.
    await withDb(UNUSED_DB, async () => {
      const a = await ask({ memo: MEMO, network: 'testnet' });
      const b = await ask({ memo: mintMemo(), network: 'testnet' });
      assert.deepEqual(await a.json(), await b.json());
      assert.equal(a.status, b.status);
    });
  });

  it('is never cached', async () => {
    await withDb(UNUSED_DB, async () => {
      const res = await ask({ memo: MEMO, network: 'testnet' });
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    });
  });
});
