import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { DEPLOYMENTS } from '../deployments.ts';
import { mockBindings, mockResolver } from './support/fake-soroban.ts';

/**
 * A testnet-only deployment must never answer a mainnet balance read.
 *
 * `requestNetwork` is the choke point; the route is the one place a browser
 * would actually hit it for a number beside the wallet. The choke point
 * re-reads the Pollar key from the environment on every call, so this file
 * sets a testnet key around the assertions that need a testnet-only deploy
 * (and restores afterwards so sibling files keep seeing "no key").
 *
 * Bindings are mocked the same way as faucet-route: the handler imports the
 * contract clients, which cannot load under strip-types.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';

mockBindings();
mockResolver();

const ADDRESS = DEPLOYMENTS.testnet.resolver;
const TESTNET_KEY = 'pk_test_balance_gate';

describe('balance route network gate', () => {
  let GET: (req: Request) => Promise<Response>;
  let human: string;
  let requestNetwork: typeof import('../server-network.ts').requestNetwork;
  let prevKey: string | undefined;
  let prevMain: string | undefined;

  before(async () => {
    prevKey = env.NEXT_PUBLIC_POLLAR_API_KEY;
    prevMain = env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;
    // Set before the dynamic import so a fresh load of pollar.ts (if any)
    // also sees the testnet key; requestNetwork re-reads env either way.
    env.NEXT_PUBLIC_POLLAR_API_KEY = TESTNET_KEY;
    delete env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;

    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    ({ requestNetwork } = await import('../server-network.ts'));
    GET = (await import('../../app/api/balance/route.ts')).GET;
  });

  after(() => {
    if (prevKey === undefined) delete env.NEXT_PUBLIC_POLLAR_API_KEY;
    else env.NEXT_PUBLIC_POLLAR_API_KEY = prevKey;
    if (prevMain === undefined) delete env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;
    else env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET = prevMain;
  });

  const ask = (network: string | null) => {
    const q = new URLSearchParams({ address: ADDRESS });
    if (network !== null) q.set('network', network);
    return GET(
      new Request(`https://changuito.test/api/balance?${q}`, {
        headers: { cookie: human, 'x-real-ip': '203.0.113.9' },
      }),
    );
  };

  it('RULE: mainnet is refused when it is not served', async () => {
    // Pin the choke point with an explicit testnet login so a suite that
    // already imported pollar.ts without a key still fails for the right
    // reason. The route below exercises the same gate via the live env key.
    assert.equal(requestNetwork('mainnet', 'testnet').ok, false);

    const res = await ask('mainnet');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'network_not_served' });
  });

  it('accepts an absent network as the default', async () => {
    // Absent is served. Horizon is not stubbed here, so the handler may 502 —
    // what matters is we did not refuse the network itself.
    const res = await ask(null);
    assert.notEqual(res.status, 400);
  });
});
