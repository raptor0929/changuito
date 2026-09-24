import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { gateFaucet } from '../faucet-gate.ts';
import { faucetProofMessage } from '../faucet-proof.ts';
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
  const message = faucetProofMessage(address, now);
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
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now);
    assert.deepEqual(res, { address: tester.publicKey(), kind: 'account' });
  });

  it('refuses a stranger’s wallet with 403', async () => {
    const res = await gateFaucet(await post({ address: stranger.publicKey(), proof: signed(stranger) }), env, now);
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_not_allowed' });
  });

  it('refuses the tester’s address with no session proof with 401', async () => {
    // The QA repro: POST { address } straight at the API.
    const res = await gateFaucet(await post({ address: tester.publicKey() }), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_session_required' });
  });

  it('refuses a forged proof for the tester’s address', async () => {
    const forged = { ...signed(stranger, tester.publicKey()) };
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: forged }), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'faucet_proof_invalid' });
  });

  it('refuses everyone when production has no allowlist', async () => {
    const closed = { ...env, FAUCET_ALLOWLIST_ADDRESSES: '' } as NodeJS.ProcessEnv;
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), closed, now);
    assert.deepEqual(await refusal(res), { status: 403, error: 'faucet_disabled' });
  });

  it('still requires the human cookie first', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }, { human: false }), env, now);
    assert.deepEqual(await refusal(res), { status: 403, error: 'solo_humanos' });
  });

  it('rejects a body that is not an address', async () => {
    const res = await gateFaucet(await post({ address: 'tester@example.com' }), env, now);
    assert.equal((await refusal(res)).status, 400);
  });
});
