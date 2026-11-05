import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { signedProof } from './support/proof.ts';

/**
 * POST /api/session/login and /api/session/logout, as the route handlers.
 *
 * Pollar's email OTP happens in Pollar's own client; what reaches this server
 * is the result: a SEP-53 signature over a login message from the wallet that
 * session unlocked. lib/test/session-issue.test.ts covers each refusal; this
 * covers the routes end to end: a fresh proof gets a hardened cookie for that
 * wallet and nothing else, a proof for another wallet or a stale one gets
 * nothing, and logout clears the cookie.
 */
const env = process.env as Record<string, string | undefined>;
delete env.DATABASE_URL;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
env.CHG_SESSION_SECRET = 'session-test-secret';

describe('session routes', () => {
  let login: (req: Request) => Promise<Response>;
  let logout: (req: Request) => Promise<Response>;
  let human: string;
  const wallet = Keypair.random();
  const other = Keypair.random();

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    login = (await import('../../app/api/session/login/route.ts')).POST;
    logout = (await import('../../app/api/session/logout/route.ts')).POST;
  });

  const post = (path: string, body: unknown, cookie = human) =>
    new Request(`https://app.changuito.me${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  it('login: a fresh wallet proof gets an HttpOnly, Secure, SameSite cookie for that wallet', async () => {
    const res = await login(post('/api/session/login', { address: wallet.publicKey(), proof: signedProof(wallet, 'login') }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).address, wallet.publicKey());
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^chg_user=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag), flag);

    const { readLoggedInUser } = await import('../login-gate.ts');
    const who = await readLoggedInUser(new Request('https://app.changuito.me/', { headers: { cookie: cookie.split(';')[0]! } }));
    assert.deepEqual(who, { ok: true, address: wallet.publicKey() });
  });

  it('login: a proof signed by another wallet, a stale one, or none gets 401 and no cookie', async () => {
    const cases = [
      { address: wallet.publicKey(), proof: signedProof(other, 'login', undefined, Date.now(), wallet.publicKey()) },
      { address: wallet.publicKey(), proof: signedProof(wallet, 'login', undefined, Date.now() - 60 * 60_000) },
      { address: wallet.publicKey(), proof: signedProof(wallet, 'faucet') },
      { address: wallet.publicKey() },
    ];
    for (const body of cases) {
      const res = await login(post('/api/session/login', body));
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('set-cookie'), null);
    }
  });

  it('login: needs the human check first', async () => {
    const res = await login(post('/api/session/login', { address: wallet.publicKey(), proof: signedProof(wallet, 'login') }, ''));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('logout: needs the human check, then clears the cookie', async () => {
    const refused = await logout(post('/api/session/logout', {}, ''));
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get('set-cookie'), null);

    const res = await logout(post('/api/session/logout', {}));
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^chg_user=;/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
  });
});
