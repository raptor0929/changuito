import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, isConfigured } from '../deployments.ts';
import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import { buyerMayClose, gateSettle } from '../settle-gate.ts';
import { walletProofMessage, type WalletIntent } from '../wallet-proof.ts';

/**
 * POST /api/settle up to the chain. Audit S1: anyone who knew an order id
 * (public in the contract's events) could settle or refund it.
 */

const SECRET = 'turnstile-test-secret';
const now = Date.now();
const buyer = Keypair.random();
const stranger = Keypair.random();
const ORDER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const BASKET = 'c'.repeat(64);
const env = { NODE_ENV: 'production', TURNSTILE_SECRET_KEY: SECRET } as NodeJS.ProcessEnv;
/** The same, plus a tester who is cleared for modo real. */
const real = { ...env, REAL_MODE_ALLOWLIST_ADDRESSES: buyer.publicKey() } as NodeJS.ProcessEnv;

function signed(kp: Keypair, intent: WalletIntent, ref: string, address = kp.publicKey()) {
  const message = walletProofMessage(intent, address, now, ref);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}

async function post(body: unknown, { human = true } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(SECRET))}`;
  return new Request('https://app.changuito.me/api/settle', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function refusal(res: unknown): Promise<{ status: number; error: string }> {
  assert.ok(res instanceof Response, 'expected a refusal');
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

const settle = (extra: Record<string, unknown> = {}) => ({
  action: 'settle',
  orderId: ORDER,
  basketHash: BASKET,
  address: buyer.publicKey(),
  ...extra,
});

describe('POST /api/settle gate', () => {
  it('refuses an anonymous settle — order id and basket alone', async () => {
    const res = await gateSettle(await post({ action: 'settle', orderId: ORDER, basketHash: BASKET }), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'buyer_proof_required' });
  });

  it('refuses an anonymous refund', async () => {
    const res = await gateSettle(await post({ action: 'refund', orderId: ORDER, address: buyer.publicKey() }), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'buyer_proof_required' });
  });

  it('refuses a stranger signing in the buyer’s name', async () => {
    const res = await gateSettle(await post(settle({ proof: signed(stranger, 'settle', ORDER, buyer.publicKey()) })), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'buyer_proof_invalid' });
  });

  it('refuses a refund proof used to settle, and a proof for another order', async () => {
    const asRefund = await gateSettle(await post(settle({ proof: signed(buyer, 'refund', ORDER) })), env, now);
    assert.deepEqual(await refusal(asRefund), { status: 401, error: 'buyer_proof_invalid' });
    const other = await gateSettle(await post(settle({ proof: signed(buyer, 'settle', OTHER) })), env, now);
    assert.deepEqual(await refusal(other), { status: 401, error: 'buyer_proof_invalid' });
  });

  it('no longer reads an unknown action as settle', async () => {
    const res = await gateSettle(await post(settle({ action: 'release', proof: signed(buyer, 'settle', ORDER) })), env, now);
    assert.equal((await refusal(res)).status, 400);
  });

  it('still requires the human cookie', async () => {
    const res = await gateSettle(await post(settle({ proof: signed(buyer, 'settle', ORDER) }), { human: false }), env, now);
    assert.deepEqual(await refusal(res), { status: 403, error: 'solo_humanos' });
  });

  it('passes the buyer’s own signed request on to the order check', async () => {
    const res = await gateSettle(await post(settle({ proof: signed(buyer, 'settle', ORDER) })), env, now);
    assert.deepEqual(res, {
      action: 'settle',
      orderId: ORDER,
      basketHash: BASKET,
      address: buyer.publicKey(),
      network: DEFAULT_NETWORK,
    });
  });
});

/**
 * Modo real. The client-side toggle is a courtesy; this is the wall, and the
 * order of the checks is the point — the allowlist is read against an address
 * that has already proven itself with a signature.
 */
describe('POST /api/settle in modo real', () => {
  const asMainnet = (extra: Record<string, unknown> = {}) => settle({ network: 'mainnet', ...extra });

  it('defaults to the safe network when the body says nothing', async () => {
    const res = await gateSettle(await post(settle({ proof: signed(buyer, 'settle', ORDER) })), env, now);
    assert.ok(!(res instanceof Response));
    assert.equal(res.network, DEFAULT_NETWORK);
    assert.equal(res.network, 'testnet');
  });

  it('refuses a network nobody has heard of rather than falling back to one', async () => {
    const res = await gateSettle(await post(settle({ network: 'mainet', proof: signed(buyer, 'settle', ORDER) })), env, now);
    assert.equal((await refusal(res)).status, 400);
  });

  it('RULE: refuses modo real from an address that is not on the list', async () => {
    const res = await gateSettle(await post(asMainnet({ proof: signed(buyer, 'settle', ORDER) })), env, now);
    assert.deepEqual(await refusal(res), { status: 403, error: 'network_not_allowed' });
  });

  it('RULE: checks the list only after the signature — an unsigned request is still a 401', async () => {
    // If the allowlist were read first, a stranger could learn who is on it by
    // watching which refusal comes back without signing anything.
    const res = await gateSettle(await post({ action: 'settle', orderId: ORDER, basketHash: BASKET, network: 'mainnet' }), env, now);
    assert.deepEqual(await refusal(res), { status: 401, error: 'buyer_proof_required' });

    const forged = await gateSettle(
      await post(asMainnet({ proof: signed(stranger, 'settle', ORDER, buyer.publicKey()) })),
      real,
      now,
    );
    assert.deepEqual(await refusal(forged), { status: 401, error: 'buyer_proof_invalid' });
  });

  it('lets an allowlisted buyer through, once mainnet is actually deployed', async () => {
    const res = await gateSettle(await post(asMainnet({ proof: signed(buyer, 'settle', ORDER) })), real, now);
    if (isConfigured('mainnet')) {
      assert.deepEqual(res, {
        action: 'settle',
        orderId: ORDER,
        basketHash: BASKET,
        address: buyer.publicKey(),
        network: 'mainnet',
      });
    } else {
      assert.deepEqual(await refusal(res), { status: 403, error: 'network_not_deployed' });
    }
  });

  it('gates a refund exactly like a settle — the escape hatch is not a back door', async () => {
    const res = await gateSettle(
      await post({ action: 'refund', orderId: ORDER, address: buyer.publicKey(), network: 'mainnet', proof: signed(buyer, 'refund', ORDER) }),
      env,
      now,
    );
    assert.deepEqual(await refusal(res), { status: 403, error: 'network_not_allowed' });
  });
});

describe('buyerMayClose', () => {
  it('lets only the buyer the contract recorded close the order', () => {
    // A stranger can sign for their own wallet; the order is not theirs.
    assert.equal(buyerMayClose(buyer.publicKey(), buyer.publicKey()), true);
    assert.equal(buyerMayClose(buyer.publicKey(), stranger.publicKey()), false);
  });
});
