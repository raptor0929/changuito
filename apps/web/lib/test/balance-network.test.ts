import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { DEPLOYMENTS } from '../deployments.ts';
import { requestNetwork } from '../server-network.ts';
import { mockBindings, mockResolver } from './support/fake-soroban.ts';

/**
 * A testnet-only deployment must never answer a mainnet balance read.
 *
 * `requestNetwork` is the choke point; the route is the one place a browser
 * would actually hit it for a number beside the wallet. With no Pollar key
 * (the unit-test default) LOGIN_NETWORK is null and only testnet is served.
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

describe('balance route network gate', () => {
  let GET: (req: Request) => Promise<Response>;
  let human: string;

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    GET = (await import('../../app/api/balance/route.ts')).GET;
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
    // Pin the choke point first so a route regression that bypasses it still
    // fails this suite for the right reason.
    assert.equal(requestNetwork('mainnet').ok, false);

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
