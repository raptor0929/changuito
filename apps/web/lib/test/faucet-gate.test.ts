import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK } from '../deployments.ts';
import { FAUCET_GRANTS_PER_HOUR, gateFaucet } from '../faucet-gate.ts';
import { CounterUnavailable, memoryCounter, type TurnCounter } from '../login-gate.ts';
import { walletProofMessage } from '../wallet-proof.ts';
import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import type { NetworkId } from '../deployments.ts';
import type { WalletDirectory, WalletStanding } from '../wallet-record.ts';

/**
 * POST /api/faucet up to the point where it would touch the chain. A test
 * that gets a Response back is a request the faucet refused without calling
 * friendbot or the mint.
 */

const SECRET = 'turnstile-test-secret';
const now = Date.now();
const tester = Keypair.random();
const stranger = Keypair.random();

const env = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: SECRET,
} as NodeJS.ProcessEnv;

function signed(kp: Keypair, address = kp.publicKey()) {
  const message = walletProofMessage('faucet', address, now);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}

async function post(body: unknown, { human = true } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(SECRET))}`;
  return new Request('https://app.changuito.me/api/faucet', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function refusal(res: unknown): Promise<{ status: number; error: string }> {
  assert.ok(res instanceof Response, 'expected a refusal');
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

describe('POST /api/faucet gate', () => {
  it('lets a granted wallet through with a signed session proof', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(res, { address: tester.publicKey(), kind: 'account', network: DEFAULT_NETWORK });
    assert.equal(book.inserts(), 0);
  });

  it('refuses to fund in modo real, and refuses a network it does not know', async () => {
    const real = await gateFaucet(
      await post({ address: tester.publicKey(), proof: signed(tester), network: 'mainnet' }),
      env,
      now,
      memoryCounter(),
    );
    assert.deepEqual(await refusal(real), { status: 403, error: 'faucet_not_on_network' });

    const typo = await gateFaucet(
      await post({ address: tester.publicKey(), proof: signed(tester), network: 'main' }),
      env,
      now,
      memoryCounter(),
    );
    assert.equal((await refusal(typo)).status, 400);
  });

  it('refuses a stranger’s wallet with 403', async () => {
    const res = await gateFaucet(await post({ address: stranger.publicKey(), proof: signed(stranger) }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_not_allowed' });
  });

  it('refuses the granted address with no session proof with 401', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey() }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_session_required' });
  });

  it('refuses a forged proof for the granted address', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const forged = { ...signed(stranger, tester.publicKey()) };
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: forged }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_proof_invalid' });
  });

  it('refuses a wallet the database has not granted', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_not_allowed' });
  });

  it('still requires the human cookie first', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }, { human: false }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'solo_humanos' });
  });

  it('holds a second grant inside the cooldown, across instances', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const store = memoryCounter();
    const first = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store, book.directory);
    assert.ok(!(first instanceof Response));
    const second = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store, book.directory);
    assert.deepEqual(await refusal(second), { status: 429, error: 'rate_limited' });
  });

  it('stops every tester together at the hourly ceiling', async () => {
    const store = memoryCounter();
    const book = memoryWallets([], true);
    const testers = Array.from({ length: FAUCET_GRANTS_PER_HOUR + 1 }, () => Keypair.random());
    const results: unknown[] = [];
    for (const kp of testers) {
      results.push(await gateFaucet(await post({ address: kp.publicKey(), proof: signed(kp) }), env, now, store, book.directory));
    }
    assert.equal(results.filter((r) => !(r instanceof Response)).length, FAUCET_GRANTS_PER_HOUR);
    assert.deepEqual(await refusal(results.at(-1)), { status: 429, error: 'rate_limited' });
  });

  it('refuses when the shared counter is down, instead of minting', async () => {
    const down: TurnCounter = {
      kind: 'redis',
      get: async () => {
        throw new CounterUnavailable('down');
      },
      incr: async () => {
        throw new CounterUnavailable('down');
      },
    };
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, down, book.directory);
    assert.deepEqual(await refusal(res), { status: 503, error: 'limiter_unavailable' });
  });

  it('rejects a body that is not an address', async () => {
    const res = await gateFaucet(await post({ address: 'tester@example.com' }), env, now, memoryCounter());
    assert.equal((await refusal(res)).status, 400);
  });

  it('refuses a banned wallet before the allowlist', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), banned: true, faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(res), { status: 403, error: 'wallet_banned' });
    assert.equal(book.inserts(), 0);
  });

  it('does not insert a wallet for an unproven faucet request', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey() }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_session_required' });
    assert.equal(book.inserts(), 0);
    const dev = { NODE_ENV: 'development', TURNSTILE_SECRET_KEY: SECRET } as NodeJS.ProcessEnv;
    const openBook = memoryWallets();
    const ungranted = await gateFaucet(await post({ address: stranger.publicKey() }), dev, now, memoryCounter(), openBook.directory);
    assert.deepEqual(await refusal(ungranted), { status: 403, error: 'faucet_not_allowed' });
    assert.equal(openBook.inserts(), 0);
  });

  it('lets a granted wallet through without an env list, and does not insert', async () => {
    const book = memoryWallets([{ address: stranger.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(
      await post({ address: stranger.publicKey(), proof: signed(stranger) }),
      env,
      now,
      memoryCounter(),
      book.directory,
    );
    assert.deepEqual(res, { address: stranger.publicKey(), kind: 'account', network: DEFAULT_NETWORK });
    assert.equal(book.inserts(), 0);
  });
});

function memoryWallets(seed: { address: string; banned?: boolean; faucetAllowed?: boolean }[] = [], open = false): {
  directory: WalletDirectory;
  inserts: () => number;
} {
  const rows = new Map<string, { faucetAllowed: boolean; banned: boolean }>();
  let inserts = 0;
  for (const row of seed) rows.set(`testnet:${row.address}`, { faucetAllowed: row.faucetAllowed === true, banned: row.banned === true });
  function read(network: NetworkId, address: string): WalletStanding {
    const row = rows.get(`${network}:${address}`);
    if (!row) return { network, faucetAllowed: false, banned: false, stored: false };
    return { network, faucetAllowed: row.faucetAllowed, banned: row.banned, stored: true };
  }
  return {
    inserts: () => inserts,
    directory: {
      async register(network, address) {
        const key = `${network}:${address}`;
        if (!rows.has(key)) {
          rows.set(key, { faucetAllowed: false, banned: false });
          inserts += 1;
        }
        return read(network, address);
      },
      async standing(network, address) {
        return read(network, address);
      },
      async openToAll() {
        return open;
      },
    },
  };
}
