import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { FAUCET_GRANTS_PER_HOUR, gateFaucet } from '../faucet-gate.ts';
import { CounterUnavailable, memoryCounter, type TurnCounter } from '../login-gate.ts';
import { walletProofMessage } from '../wallet-proof.ts';
import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';

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
  FAUCET_ALLOWLIST_ADDRESSES: tester.publicKey(),
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
  it('lets the allowlisted tester through with a signed session proof', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter());
    assert.deepEqual(res, { address: tester.publicKey(), kind: 'account' });
  });

  it('refuses a stranger’s wallet with 403', async () => {
    const res = await gateFaucet(await post({ address: stranger.publicKey(), proof: signed(stranger) }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_not_allowed' });
  });

  it('refuses the tester’s address with no session proof with 401', async () => {
    // The QA repro: POST { address } straight at the API.
    const res = await gateFaucet(await post({ address: tester.publicKey() }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_session_required' });
  });

  it('refuses a forged proof for the tester’s address', async () => {
    const forged = { ...signed(stranger, tester.publicKey()) };
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: forged }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_proof_invalid' });
  });

  it('refuses everyone when production has no allowlist', async () => {
    const closed = { ...env, FAUCET_ALLOWLIST_ADDRESSES: '' } as NodeJS.ProcessEnv;
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), closed, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_disabled' });
  });

  it('still requires the human cookie first', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }, { human: false }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'solo_humanos' });
  });

  it('holds a second grant inside the cooldown, across instances', async () => {
    const store = memoryCounter();
    const first = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store);
    assert.ok(!(first instanceof Response));
    const second = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store);
    assert.deepEqual(await refusal(second), { status: 429, error: 'rate_limited' });
  });

  it('stops every tester together at the hourly ceiling', async () => {
    const store = memoryCounter();
    const testers = Array.from({ length: FAUCET_GRANTS_PER_HOUR + 1 }, () => Keypair.random());
    const many = { ...env, FAUCET_ALLOWLIST_ADDRESSES: testers.map((k) => k.publicKey()).join(',') } as NodeJS.ProcessEnv;
    const results: unknown[] = [];
    for (const kp of testers) {
      results.push(await gateFaucet(await post({ address: kp.publicKey(), proof: signed(kp) }), many, now, store));
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
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, down);
    assert.deepEqual(await refusal(res), { status: 503, error: 'limiter_unavailable' });
  });

  it('rejects a body that is not an address', async () => {
    const res = await gateFaucet(await post({ address: 'tester@example.com' }), env, now, memoryCounter());
    assert.equal((await refusal(res)).status, 400);
  });
});
