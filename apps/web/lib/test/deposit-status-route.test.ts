import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

/**
 * GET /api/deposit, the checkout's status poll: has the shopper's USDC payment
 * with this memo landed on the receive account yet? The ledger (Horizon) is
 * scripted through lib/ledger/index.ts.
 *
 * The two promises it must keep, both about not telling a shopper who paid
 * that they have not: an unreachable ledger is a 502, never "waiting"; and a
 * confirmed payment stays confirmed even when the database cannot record it.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
delete env.DATABASE_URL;

const RECEIVE = 'GRECEIVEFAKE';
const ledger = {
  address: RECEIVE as string | null,
  hit: null as null | { txHash: string; amount: string; at: string },
  fail: null as Error | null,
  queries: [] as unknown[],
};
mock.module(new URL('../ledger/index.ts', import.meta.url).href, {
  namedExports: {
    activeLedger: () => ({
      receiveAddress: () => ledger.address,
      asset: () => ({ code: 'USDC', issuer: 'GISSUERFAKE' }),
      async findDeposit(_net: string, want: unknown) {
        ledger.queries.push(want);
        if (ledger.fail) throw ledger.fail;
        return ledger.hit;
      },
    }),
  },
});

describe('GET /api/deposit (status poll)', () => {
  let GET: (req: Request) => Promise<Response>;
  let human: string;
  let MEMO: string;
  const realError = console.error;
  let logs: string[] = [];

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    MEMO = (await import('../deposit.ts')).mintMemo();
    GET = (await import('../../app/api/deposit/route.ts')).GET;
  });
  beforeEach(() => {
    ledger.address = RECEIVE;
    ledger.hit = null;
    ledger.fail = null;
    ledger.queries = [];
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  });
  after(() => void (console.error = realError));

  const poll = async (memo = MEMO, amount = '12.5', cookie = human) => {
    const res = await GET(
      new Request(`https://app.changuito.me/api/deposit?memo=${encodeURIComponent(memo)}&amount=${amount}`, { headers: { cookie } }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('needs the human check', async () => {
    assert.equal((await poll(MEMO, '12.5', '')).status, 403);
    assert.equal(ledger.queries.length, 0);
  });

  it('refuses a malformed memo or amount before asking the ledger', async () => {
    assert.equal((await poll('nope')).status, 400);
    assert.equal((await poll(MEMO, '12.12345678')).status, 400);
    assert.equal((await poll(MEMO, '-1')).status, 400);
    assert.equal(ledger.queries.length, 0);
  });

  it('503 when this environment takes no payments', async () => {
    ledger.address = null;
    assert.equal((await poll()).status, 503);
  });

  it('waits until the ledger has the payment, asking for this memo, account and minimum', async () => {
    const r = await poll();
    assert.deepEqual(r, { status: 200, body: { status: 'waiting' } });
    assert.deepEqual(ledger.queries[0], { to: RECEIVE, asset: { code: 'USDC', issuer: 'GISSUERFAKE' }, memo: MEMO, minAmount: '12.5' });
  });

  it('confirms a landed payment even when the database cannot record it', async () => {
    ledger.hit = { txHash: 'abc123', amount: '12.5000000', at: '2026-10-17T12:00:00Z' };
    const r = await poll();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'confirmed', txHash: 'abc123', amount: '12.5000000', at: '2026-10-17T12:00:00Z' });
    assert.match(logs.join('\n'), /confirmed but not recorded/);
  });

  it('an unreachable ledger is a 502 in plain words, never "waiting"', async () => {
    ledger.fail = new Error('Request failed with status code 503 https://horizon.stellar.org/accounts/…');
    const r = await poll();
    assert.equal(r.status, 502);
    assert.notEqual(r.body.status, 'waiting');
    assert.doesNotMatch(JSON.stringify(r.body), /horizon|https?:/i);
  });
});
