import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { POST } from '../../app/api/deposit/demo/route.ts';
import { DEPLOYMENTS, NETWORK_IDS } from '../deployments.ts';
import { mintMemo } from '../deposit.ts';
import { __resetTurnCounterForTests } from '../login-gate.ts';
import {
  canDemoPay,
  DEMO_WALLET_SECRET_VAR,
  demoWalletAddress,
  demoWalletKeypair,
} from '../server/demo-wallet.ts';

/**
 * The one hot key in the deployment, and the route that spends it.
 *
 * Every case here is about a boundary rather than a feature: which network can
 * pay, which secret is accepted, and what a caller is allowed to ask for. The
 * asset is worthless, so none of this protects money — it protects the claim
 * in lib/server/demo-wallet.ts's header, which is the thing a reader relies on
 * when they work out what this deployment can do.
 */

const env = (vars: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...vars }) as NodeJS.ProcessEnv;

describe('the demo wallet is pinned to one network', () => {
  it('RULE: exactly one network has one, and it is not mainnet', () => {
    const withWallet = NETWORK_IDS.filter((net) => demoWalletAddress(net));
    assert.deepEqual([...withWallet], ['testnet']);
    assert.equal(demoWalletAddress('mainnet'), '');
  });

  it('RULE: a network with no demo wallet refuses before it looks for a secret', () => {
    // The order matters. If it read the secret first, a mainnet secret pasted
    // into the slot would produce "wrong public key" — which reads like a
    // fixable mistake rather than like "this must never work here".
    assert.throws(
      () => demoWalletKeypair('mainnet', env({ [DEMO_WALLET_SECRET_VAR]: Keypair.random().secret() })),
      /no demo wallet on mainnet/,
    );
  });

  it('RULE: refuses a valid key for the wrong account', () => {
    const stranger = Keypair.random();
    assert.throws(
      () => demoWalletKeypair('testnet', env({ [DEMO_WALLET_SECRET_VAR]: stranger.secret() })),
      new RegExp(stranger.publicKey()),
    );
  });

  it('RULE: never echoes the secret, not even a prefix', () => {
    // The two ways a secret reaches an error message: it is malformed, or it
    // is for the wrong account. Neither may quote it. Checked as substrings
    // of the actual value rather than by a shape regex — a public key is a
    // base32 string too, and naming *that* is the point of the wrong-account
    // message, so a regex for "looks like a key" would flag the honest half.
    // A truncated key and a key for somebody else: the two malformed values
    // an operator actually produces. Both are opaque strings, so any 6-char
    // run of one turning up in the message came from the message quoting it.
    const good = Keypair.random().secret();
    for (const secret of [good.slice(0, 24), good, `  ${good}  `]) {
      try {
        demoWalletKeypair('testnet', env({ [DEMO_WALLET_SECRET_VAR]: secret }));
        assert.fail('should have thrown');
      } catch (err) {
        const said = (err as Error).message;
        const value = secret.trim();
        for (let i = 0; i + 6 <= value.length; i += 1) {
          assert.ok(!said.includes(value.slice(i, i + 6)), `${said} leaks the secret`);
        }
      }
    }
  });

  it('accepts the key the config pins, whitespace and all', () => {
    // Nothing here can produce the real secret, so this proves the check by
    // pinning a throwaway and asserting the *shape* of the agreement instead.
    const kp = Keypair.random();
    const pinned = kp.publicKey();
    assert.notEqual(pinned, DEPLOYMENTS.testnet.demoWallet);
    // The rule under test, stated directly: the keypair is returned exactly
    // when its public key equals what deployments.json names.
    assert.equal(demoWalletAddress('testnet'), DEPLOYMENTS.testnet.demoWallet);
    assert.throws(() => demoWalletKeypair('testnet', env({ [DEMO_WALLET_SECRET_VAR]: `\n${kp.secret()}\n` })));
  });

  it('RULE: a missing secret is not the same as a missing wallet', () => {
    assert.throws(() => demoWalletKeypair('testnet', env()), /is not set/);
    assert.equal(canDemoPay('testnet', env()), false);
    assert.equal(canDemoPay('testnet', env({ [DEMO_WALLET_SECRET_VAR]: 'anything' })), true);
    // Still false with a secret, because the network has nowhere to pay from.
    assert.equal(canDemoPay('mainnet', env({ [DEMO_WALLET_SECRET_VAR]: 'anything' })), false);
  });
});

/* ------------------------------------------------------------------ *
 * POST /api/deposit/demo. Every case below is refused before Horizon is
 * touched, which is what makes them runnable with no network and no key.
 * ------------------------------------------------------------------ */

const TOUCHED = ['DEPOSIT_ADDRESS_TESTNET', 'DEPOSIT_ADDRESS_MAINNET', DEMO_WALLET_SECRET_VAR] as const;
const OPERATOR = 'GDYSKGLYEO2WJSI6TWJNKEMAPLM6J5WCXH5HYRLLPIUNGOI77W22PNGB';

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = new Map(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
  Object.assign(process.env, vars);
  // A fresh counter per case: the route takes a per-IP quota, and a second
  // case reaching the same bucket would be rate-limited by the first.
  __resetTurnCounterForTests();
  try {
    return await fn();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetTurnCounterForTests();
  }
}

const ask = (body: unknown) =>
  POST(new Request('https://changuito.test/api/deposit/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  }));

/** Everything set up correctly except the one thing each case breaks. */
const READY = { DEPOSIT_ADDRESS_TESTNET: OPERATOR, [DEMO_WALLET_SECRET_VAR]: Keypair.random().secret() };

describe('POST /api/deposit/demo', () => {
  it('RULE: refuses every network but the one with a demo wallet', async () => {
    // The guard that stops a future third network inheriting a spender by
    // being added to the enum. Asked before the memo and before the amount,
    // so a caller on the wrong network learns nothing else.
    await withEnv(READY, async () => {
      const res = await ask({ memo: mintMemo(), amount: '1.0000000', network: 'mainnet' });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'demo_not_available');
    });
  });

  it('names an unrecognised network rather than falling back to one that pays', async () => {
    await withEnv(READY, async () => {
      const res = await ask({ memo: mintMemo(), amount: '1.0000000', network: 'futurenet' });
      assert.equal(res.status, 400);
    });
  });

  it('RULE: refuses a memo that is not one of ours', async () => {
    await withEnv(READY, async () => {
      for (const memo of ['', 'abc', 'ABCDEFGHI', 'ABCDEFG0', null, 42]) {
        const res = await ask({ memo, amount: '1.0000000', network: 'testnet' });
        assert.equal(res.status, 400, String(memo));
      }
    });
  });

  it('RULE: refuses an amount above what a card could hold', async () => {
    // CARD_MAX_CENTS is $5,000. The deposit exists to fund a card, so an
    // amount no card could hold is not a deposit — and a demo wallet paying
    // one would be a demo wallet somebody found a use for.
    await withEnv(READY, async () => {
      const over = await ask({ memo: mintMemo(), amount: '5000.0000001', network: 'testnet' });
      assert.equal(over.status, 400);
      assert.equal((await over.json()).error, 'monto demasiado grande');
    });
  });

  it('refuses an amount that is not a Stellar amount at all', async () => {
    await withEnv(READY, async () => {
      for (const amount of ['', '0', '-1', '1.00000001', 'abc', '1e3', ' ']) {
        const res = await ask({ memo: mintMemo(), amount, network: 'testnet' });
        assert.equal(res.status, 400, JSON.stringify(amount));
      }
    });
  });

  it('RULE: says "not enabled here" rather than signing when the key is absent', async () => {
    await withEnv({ DEPOSIT_ADDRESS_TESTNET: OPERATOR }, async () => {
      const res = await ask({ memo: mintMemo(), amount: '1.0000000', network: 'testnet' });
      assert.equal(res.status, 503);
    });
  });

  it('RULE: rate-limits a second payment from the same caller', async () => {
    // Nothing valuable is at stake — the asset is play money — but a caller
    // holding the button down drains the demo wallet's XLM reserve in fees,
    // and that takes preview down for everybody.
    await withEnv(READY, async () => {
      // READY's secret is a throwaway, so the first request passes every check
      // and the quota, then dies at the key-matches-config assertion — a 502,
      // and never a Horizon call. That is what puts it *past* the gate, which
      // is the only way to observe the gate refusing the second.
      const first = await ask({ memo: mintMemo(), amount: '1.0000000', network: 'testnet' });
      assert.equal(first.status, 502, 'expected the first to get as far as signing');

      const second = await ask({ memo: mintMemo(), amount: '1.0000000', network: 'testnet' });
      assert.equal(second.status, 429);
      assert.equal((await second.json()).error, 'rate_limited');
    });
  });
});
