import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * The first deploy of app.changuito.me runs with chat, cart and sign-in only.
 * The three payment variables come later, so this is the shape production has
 * on day one: production, the human gate on, and none of
 * STELLAR_RESOLVER_SECRET, DEPOSIT_ADDRESS_TESTNET or DEMO_WALLET_SECRET.
 *
 * What it must do then is say "payments are not enabled here", every time
 * and in plain words: a 503 the checkout can show, never a 500 and never a
 * thrown key error reaching the shopper. Nothing here touches the network.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
delete env.DATABASE_URL;
delete env.STELLAR_RESOLVER_SECRET;
delete env.DEPOSIT_ADDRESS_TESTNET;
delete env.DEMO_WALLET_SECRET;

const DISABLED = 'los pagos no están habilitados en este entorno';

describe('go-live without the payment secrets', () => {
  let human: string;
  const realError = console.error;
  const logs: string[] = [];

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  });
  after(() => void (console.error = realError));

  const post = (path: string, body: unknown) =>
    new Request(`https://app.changuito.me${path}`, {
      method: 'POST',
      headers: { cookie: human, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('a checkout quote answers 503 "not enabled" with no deposit address', async () => {
    const { POST } = await import('../../app/api/deposit/route.ts');
    const res = await POST(post('/api/deposit', { centavos: 150000, network: 'testnet' }));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: string }).error, DISABLED);
    assert.ok(logs.some((l) => l.includes('DEPOSIT_ADDRESS_TESTNET')), 'the log names the missing variable');
  });

  it('the demo wallet answers 503 "not enabled" with neither address nor secret', async () => {
    const { POST } = await import('../../app/api/deposit/demo/route.ts');
    const { mintMemo } = await import('../deposit.ts');
    const res = await POST(post('/api/deposit/demo', { memo: mintMemo(), amount: '1', network: 'testnet' }));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: string }).error, DISABLED);
  });

  it('the checkout is never offered the demo button without the secret', async () => {
    const { canDemoPay } = await import('../server/demo-wallet.ts');
    assert.equal(canDemoPay('testnet'), false);
  });

  // The resolver's own throw on a missing STELLAR_RESOLVER_SECRET is pinned in
  // resolver.test.ts; faucet and settle call it inside their try, which
  // answers 502 in words. Neither is reached on day one: the faucet is closed
  // in production with no allowlist, and settle needs an escrow order, which
  // needs a payment.
});
