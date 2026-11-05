import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { chain, mockBindings, mockResolver, RESOLVER_PUBLIC } from './support/fake-soroban.ts';
import { signedProof } from './support/proof.ts';

/**
 * GET/POST /api/faucet as handlers: Horizon and friendbot scripted through
 * fetch, the token contract through the fake bindings. Both friendbot and the
 * mint are paid for by us, so the gate runs first; "enough already" is an
 * answer and not a mint; and a failure answers plainly with no URL or XDR.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test'; // in-memory quotas; the human gate is still enforced by its secret
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
delete env.DATABASE_URL;
delete env.FAUCET_OPEN_TO_ALL;

mockBindings();
mockResolver();

// One tester per case: the per-address cooldown is real.
const testers = Array.from({ length: 6 }, () => Keypair.random());
env.FAUCET_ALLOWLIST_ADDRESSES = testers.map((k) => k.publicKey()).join(',');

describe('/api/faucet', () => {
  let GET: (req: Request) => Promise<Response>;
  let POST: (req: Request) => Promise<Response>;
  let human: string;
  const real = globalThis.fetch;
  const accounts = new Map<string, number>(); // address -> XLM
  let horizonDown = false;
  let friendbotCalls = 0;
  const realError = console.error;
  let logs: string[] = [];

  before(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://horizon-testnet.stellar.org/accounts/')) {
        if (horizonDown) return new Response('down', { status: 500 });
        const id = decodeURIComponent(url.split('/accounts/')[1]!);
        const xlm = accounts.get(id);
        return xlm === undefined
          ? new Response('{}', { status: 404 })
          : Response.json({ balances: [{ asset_type: 'native', balance: String(xlm) }] });
      }
      if (url.startsWith('https://friendbot.stellar.org/')) {
        friendbotCalls++;
        const id = decodeURIComponent(new URL(url).searchParams.get('addr')!);
        accounts.set(id, 10_000);
        return Response.json({ hash: 'friendbot-tx' });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    ({ GET, POST } = await import('../../app/api/faucet/route.ts'));
  });
  after(() => {
    globalThis.fetch = real;
    console.error = realError;
  });
  beforeEach(() => {
    chain.reset();
    horizonDown = false;
    friendbotCalls = 0;
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  });

  const post = (kp: Keypair, { proof = true, cookie = human } = {}) =>
    POST(
      new Request('https://app.changuito.me/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ address: kp.publicKey(), ...(proof ? { proof: signedProof(kp, 'faucet') } : {}) }),
      }),
    );

  it('GET says who may use it, behind the human check', async () => {
    const url = (a: string) => `https://app.changuito.me/api/faucet?address=${a}`;
    assert.equal((await GET(new Request(url(testers[0]!.publicKey())))).status, 403);
    const mine = await (await GET(new Request(url(testers[0]!.publicKey()), { headers: { cookie: human } }))).json();
    assert.deepEqual(mine, { mode: 'allowlist', allowed: true });
    const other = await (await GET(new Request(url(Keypair.random().publicKey()), { headers: { cookie: human } }))).json();
    assert.equal(other.allowed, false);
    const junk = await (await GET(new Request(url('not-an-address'), { headers: { cookie: human } }))).json();
    assert.equal(junk.allowed, false);
  });

  it('POST refuses without the human check, without a proof, and for a wallet off the list', async () => {
    assert.equal((await post(testers[1]!, { cookie: '' })).status, 403);
    assert.equal((await post(testers[1]!, { proof: false })).status, 401);
    assert.equal((await post(Keypair.random())).status, 403);
    assert.equal(friendbotCalls, 0);
    assert.ok(!chain.calls.some((c) => c.method === 'mint'));
  });

  it('a new tester gets XLM from friendbot and a mint signed by the resolver', async () => {
    const kp = testers[2]!;
    const res = await post(kp);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.created, true);
    assert.equal(body.address, kp.publicKey());
    assert.ok(body.txHash);
    assert.equal(friendbotCalls, 1);
    const mint = chain.calls.find((c) => c.method === 'mint');
    assert.equal(mint?.signedBy, RESOLVER_PUBLIC);
    assert.equal((mint?.args as { to: string }).to, kp.publicKey());
  });

  it('enough USDC already is a 429 answer with the balance, and no mint', async () => {
    const kp = testers[3]!;
    accounts.set(kp.publicKey(), 100);
    chain.balances.set(kp.publicKey(), 10_000_000_000n);
    const res = await post(kp);
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.txHash, null);
    assert.ok(body.note);
    assert.equal(friendbotCalls, 0, 'a funded account is not sent to friendbot');
    assert.ok(!chain.calls.some((c) => c.method === 'mint'));
  });

  it('a Horizon failure answers in plain words, with no URL', async () => {
    horizonDown = true;
    const res = await post(testers[4]!);
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.match(text, /No pudimos cargar USDC de prueba/);
    assert.doesNotMatch(text, /horizon|https?:/i);
    assert.match(logs.join('\n'), /\[faucet\] failed/);
  });
});
