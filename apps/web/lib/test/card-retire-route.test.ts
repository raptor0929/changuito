import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { POST } from '../../app/api/card/retire/route.ts';
import { WALLET_PROOF_TTL_MS, type WalletIntent, walletProofMessage } from '../wallet-proof.ts';

/**
 * Destroying the card a customer keeps, which is the one irreversible thing
 * a shopper can ask this app to do to their own money.
 *
 * Every case here is a refusal, in the order the route asks the questions.
 * The termination itself needs Vyrion and the unbinding needs Postgres, and
 * the unit suite has neither on purpose — so `DATABASE_URL` is a value that
 * is never dialled and `VYRION_API_KEY` is never spent.
 */

const owner = Keypair.random();
const stranger = Keypair.random();

const sep53 = (kp: Keypair, message: string) =>
  Buffer.from(
    kp.sign(createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest()),
  ).toString('base64');

const signed = (intent: WalletIntent, kp = owner, at = Date.now()) => {
  const message = walletProofMessage(intent, kp.publicKey(), at);
  return { message, signature: sep53(kp, message) };
};

const TOUCHED = ['DATABASE_URL', 'VYRION_API_KEY', 'REAL_MODE_ALLOWLIST_ADDRESSES'] as const;
const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Never dialled: every case is refused before the lookup. */
const UNUSED_DB = 'postgres://user:pw@db.invalid:6543/postgres';
const READY = { DATABASE_URL: UNUSED_DB, VYRION_API_KEY: 'vy_test_not_used' };

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
    new Request('https://changuito.test/api/card/retire', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
  );

describe('giving back the card you keep', () => {
  it('says so where cards are not issued at all', async () => {
    await withEnv({}, async () => {
      const res = await ask({ address: owner.publicKey(), network: 'mainnet', proof: signed('retire') });
      assert.equal(res.status, 503);
    });
  });

  it('says so where no card was ever bound to a wallet', async () => {
    // Without a database `card_owner` does not exist, so there is no kept
    // card here to give back — `keepsOneCard`'s third term, answered before
    // anybody is asked to sign for nothing.
    await withEnv({ VYRION_API_KEY: 'vy_test_not_used' }, async () => {
      const res = await ask({ address: owner.publicKey(), network: 'mainnet', proof: signed('retire') });
      assert.equal(res.status, 503);
    });
  });

  it('refuses an address that is not one', async () => {
    await withEnv(READY, async () => {
      for (const address of ['', 'not-an-address', owner.publicKey().slice(0, 40), 42]) {
        const res = await ask({ address, network: 'mainnet', proof: signed('retire') });
        assert.equal(res.status, 400, `accepted ${JSON.stringify(address)}`);
      }
    });
  });

  it('RULE: a wallet that may not use this network learns only that', async () => {
    await withEnv({ ...READY, REAL_MODE_ALLOWLIST_ADDRESSES: stranger.publicKey() }, async () => {
      const res = await ask({ address: owner.publicKey(), network: 'mainnet', proof: signed('retire') });
      assert.equal(res.status, 403);
    });
  });

  it('RULE: a public address alone destroys nothing', async () => {
    await withEnv(READY, async () => {
      const res = await ask({ address: owner.publicKey(), network: 'mainnet' });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'proof_missing');
    });
  });

  it('RULE: a signature for reading the card cannot destroy it', async () => {
    // The whole reason `retire` is its own intent. Somebody who approved
    // "ver los datos de mi tarjeta" in their wallet did not agree to close
    // the card and have the balance swept back — and until this route
    // existed, the only signature in the app that touched a card said
    // exactly that and nothing more.
    await withEnv(READY, async () => {
      for (const intent of ['card', 'orders', 'login'] as const) {
        const res = await ask({ address: owner.publicKey(), network: 'mainnet', proof: signed(intent) });
        assert.equal(res.status, 401, `${intent} was accepted`);
        assert.equal((await res.json()).error, 'proof_invalid');
      }
    });
  });

  it('refuses somebody else’s signature, however valid', async () => {
    await withEnv(READY, async () => {
      const res = await ask({
        address: owner.publicKey(),
        network: 'mainnet',
        proof: signed('retire', stranger),
      });
      assert.equal(res.status, 401);
    });
  });

  it('refuses a proof that has gone stale, and says which it is', async () => {
    await withEnv(READY, async () => {
      const old = signed('retire', owner, Date.now() - WALLET_PROOF_TTL_MS - 1_000);
      const res = await ask({ address: owner.publicKey(), network: 'mainnet', proof: old });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, 'proof_expired');
      assert.match(body.message, /venció/);
    });
  });

  it('asks for the signature in words that name what it does', async () => {
    // The shopper reads this string in their wallet and it is the only
    // description of the act they get, so it says "dar de baja" and not
    // something a card id would have to explain.
    assert.match(
      walletProofMessage('retire', owner.publicKey(), Date.now()),
      /^Changuito: dar de baja mi tarjeta con G/,
    );
  });

  it('never caches a reply about somebody’s card', async () => {
    await withEnv(READY, async () => {
      const res = await ask({ address: owner.publicKey(), network: 'mainnet' });
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
      assert.match(res.headers.get('cache-control') ?? '', /private/);
    });
  });
});
