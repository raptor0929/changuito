import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import { readLoggedInUser, sessionSecret, USER_COOKIE, verifyUserToken } from '../login-gate.ts';
import { issueUserSession } from '../session-issue.ts';
import { walletProofMessage, type WalletIntent } from '../wallet-proof.ts';
import type { NetworkId } from '../deployments.ts';
import type { WalletDirectory, WalletStanding } from '../wallet-record.ts';

/**
 * POST /api/session/login. The QA finding (audit C2): any address the
 * browser named got a 30-day `chg_user`, which skips the guest limits.
 */

const TURNSTILE = 'turnstile-test-secret';
const SESSION = 'session-test-secret';
const now = Date.now();
const shopper = Keypair.random();
const stranger = Keypair.random();

const env = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: TURNSTILE,
  CHG_SESSION_SECRET: SESSION,
} as NodeJS.ProcessEnv;

function signed(kp: Keypair, address = kp.publicKey(), intent: WalletIntent = 'login') {
  const message = walletProofMessage(intent, address, now);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}

async function post(body: unknown, { human = true } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(TURNSTILE))}`;
  return new Request('https://app.changuito.me/api/session/login', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function status(res: Response): Promise<{ status: number; error?: string; cookie: string | null }> {
  const json = (await res.json()) as { error?: string };
  return { status: res.status, error: json.error, cookie: res.headers.get('set-cookie') };
}

describe('POST /api/session/login', () => {
  it('refuses a bare address — the fake login', async () => {
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey() }), env, now));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'session_proof_required');
    assert.equal(r.cookie, null);
  });

  it('refuses a stranger signing for someone else’s address', async () => {
    const r = await status(
      await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(stranger, shopper.publicKey()) }), env, now),
    );
    assert.equal(r.status, 401);
    assert.equal(r.cookie, null);
  });

  it('refuses a proof signed for another purpose', async () => {
    const proof = signed(shopper, shopper.publicKey(), 'faucet');
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof }), env, now));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'session_proof_invalid');
  });

  it('refuses a contract address, which cannot sign SEP-53', async () => {
    const r = await status(await issueUserSession(await post({ address: 'C' + 'A'.repeat(55) }), env, now));
    assert.equal(r.status, 400);
  });

  it('issues nothing in production without CHG_SESSION_SECRET', async () => {
    const noSecret = { ...env, CHG_SESSION_SECRET: '' } as NodeJS.ProcessEnv;
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), noSecret, now));
    assert.equal(r.status, 503);
    assert.equal(r.cookie, null);
  });

  it('still needs the human cookie', async () => {
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }, { human: false }), env, now));
    assert.equal(r.status, 403);
  });

  it('signs a session for the wallet that proved itself', async () => {
    const res = await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now);
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    const token = decodeURIComponent(/chg_user=([^;]+)/.exec(cookie)?.[1] ?? '');
    const read = await verifyUserToken(token, SESSION, now);
    assert.deepEqual(read, { ok: true, address: shopper.publicKey() });
    assert.match(cookie, /HttpOnly/);
  });

  it('refuses a banned wallet and does not set a cookie', async () => {
    const book = memoryWallets([{ address: shopper.publicKey(), banned: true, faucetAllowed: true }]);
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now, book.directory));
    assert.equal(r.status, 403);
    assert.equal(r.error, 'wallet_banned');
    assert.equal(r.cookie, null);
    assert.equal(book.inserts(), 0);
    const still = await book.directory.standing('testnet', shopper.publicKey());
    assert.equal(still.banned, true);
    assert.equal(still.faucetAllowed, true);
  });

  it('records the wallet once the login proof holds', async () => {
    const book = memoryWallets();
    const res = await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now, book.directory);
    assert.equal(res.status, 200);
    assert.equal(book.inserts(), 1);
    const row = await book.directory.standing('testnet', shopper.publicKey());
    assert.equal(row.stored, true);
    assert.equal(row.banned, false);
  });
});

describe('sessionSecret', () => {
  it('takes only CHG_SESSION_SECRET in production', () => {
    assert.equal(sessionSecret({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 't' } as NodeJS.ProcessEnv), '');
    assert.equal(sessionSecret({ NODE_ENV: 'production', CHG_SESSION_SECRET: ' s ' } as NodeJS.ProcessEnv), 's');
  });

  it('keeps the local fallbacks outside production', () => {
    assert.equal(sessionSecret({ NODE_ENV: 'development', TURNSTILE_SECRET_KEY: 't' } as NodeJS.ProcessEnv), 't');
    assert.equal(sessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), 'dev-chg-session-not-for-prod');
  });

  it('accepts no cookie at all when production has no secret', async () => {
    const req = new Request('https://app.changuito.me/api/chat', { headers: { cookie: `${USER_COOKIE}=v2.1.2.3` } });
    assert.deepEqual(await readLoggedInUser(req, { NODE_ENV: 'production' } as NodeJS.ProcessEnv), { ok: false });
  });
});

function memoryWallets(seed: { address: string; banned?: boolean; faucetAllowed?: boolean }[] = []): {
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
        return false;
      },
    },
  };
}
