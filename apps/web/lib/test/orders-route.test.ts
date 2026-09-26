import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { POST } from '../../app/api/orders/route.ts';
import { WALLET_PROOF_TTL_MS, walletProofMessage } from '../wallet-proof.ts';

/**
 * The gate in front of somebody's purchase history, checked in the order the
 * route actually asks the questions.
 *
 * What is not here is a successful read: `ordersOf` needs a live Postgres, and
 * the unit suite runs with none on purpose (lib/card.ts's header says why).
 * So `DATABASE_URL` is set to a value that is never dialled — every case below
 * is refused before the query — and the reading itself is covered by
 * `npm run db:invariants` and by the production check in the plan.
 */

const buyer = Keypair.random();
const stranger = Keypair.random();

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
const sep53 = (kp: Keypair, message: string) =>
  Buffer.from(
    kp.sign(createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest()),
  ).toString('base64');

const proof = (kp: Keypair, message: string) => ({ message, signature: sep53(kp, message) });
const signed = (intent: 'orders' | 'card', kp = buyer, at = Date.now()) =>
  proof(kp, walletProofMessage(intent, kp.publicKey(), at));

const TOUCHED = ['DATABASE_URL', 'REAL_MODE_ALLOWLIST_ADDRESSES'] as const;
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

/** Never dialled: every case is refused before the query runs. */
const UNUSED_DB = 'postgres://user:pw@db.invalid:6543/postgres';

const ask = (body: unknown) =>
  POST(
    new Request('https://changuito.test/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
  );

describe('reading back what a wallet bought', () => {
  it('RULE: says there is nothing to read here before asking anyone to sign', () => {
    // Preview keeps no records at all. Making somebody approve a signature in
    // their wallet and *then* telling them there was never anything to show
    // would be the rudest available ordering, so the deployment fact is
    // answered first.
    return withEnv({}, async () => {
      const res = await ask({ address: buyer.publicKey(), network: 'testnet', proof: signed('orders') });
      assert.equal(res.status, 503);
    });
  });

  it('refuses an address that is not one', async () => {
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      for (const address of ['', 'not-an-address', buyer.publicKey().slice(0, 40), 42]) {
        const res = await ask({ address, network: 'testnet', proof: signed('orders') });
        assert.equal(res.status, 400, `accepted ${JSON.stringify(address)}`);
      }
    });
  });

  it('RULE: a wallet that may not use this network learns only that', async () => {
    // Asked before the proof, so a stranger cannot tell a wrong signature from
    // a network they are not on — and never learns whether the wallet they
    // asked about has bought anything here.
    await withEnv({ DATABASE_URL: UNUSED_DB, REAL_MODE_ALLOWLIST_ADDRESSES: stranger.publicKey() }, async () => {
      const res = await ask({ address: buyer.publicKey(), network: 'mainnet', proof: signed('orders') });
      assert.equal(res.status, 403);
    });
  });

  it('RULE: a public address alone buys nothing', async () => {
    // The whole reason this is not a GET with an address in the query string.
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      const res = await ask({ address: buyer.publicKey(), network: 'testnet' });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'proof_missing');
    });
  });

  it('RULE: a signature for reading a card cannot list purchases', async () => {
    // One intent per purpose, which is the property walletProofMessage exists
    // for. A shopper who approved "ver los datos de mi tarjeta" did not agree
    // to hand over a list of everything they have ever bought.
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      const res = await ask({ address: buyer.publicKey(), network: 'testnet', proof: signed('card') });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'proof_invalid');
    });
  });

  it('refuses somebody else’s signature, however valid', async () => {
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      const theirs = signed('orders', stranger);
      const res = await ask({ address: buyer.publicKey(), network: 'testnet', proof: theirs });
      assert.equal(res.status, 401);
    });
  });

  it('refuses a proof that has gone stale, and says which it is', async () => {
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      const old = signed('orders', buyer, Date.now() - WALLET_PROOF_TTL_MS - 1_000);
      const res = await ask({ address: buyer.publicKey(), network: 'testnet', proof: old });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, 'proof_expired');
      // The two 401s read differently on purpose: "venció" tells the shopper
      // to try again, where the generic one would have them wondering what
      // they did wrong.
      assert.match(body.message, /venció/);
    });
  });

  it('RULE: never caches a reply about somebody’s purchases', async () => {
    await withEnv({ DATABASE_URL: UNUSED_DB }, async () => {
      const res = await ask({ address: buyer.publicKey(), network: 'testnet' });
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
      assert.match(res.headers.get('cache-control') ?? '', /private/);
    });
  });
});
