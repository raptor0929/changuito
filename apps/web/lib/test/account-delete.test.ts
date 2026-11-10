import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * POST /api/account/delete. No database: the memory maps are what a fresh
 * clone stores. The confirm string is required. The session cookie is the
 * identity, and it is cleared only after the delete runs.
 */
const env = process.env as Record<string, string | undefined>;
delete env.DATABASE_URL;
env.NODE_ENV = 'test';
env.CHG_SESSION_SECRET = 'session-test-secret';
env.PROFILE_ENC_KEY = randomBytes(32).toString('base64');

const SECRET = env.CHG_SESSION_SECRET;
const ADDRESS = 'DeleteWallet11111111111111111111111111111';
const OTHER = 'OtherWallet1111111111111111111111111111111';

describe('account delete', () => {
  it('keeps the usage-counter key and the turn key in step with their modules', () => {
    const gate = readFileSync(new URL('../login-gate.ts', import.meta.url), 'utf8');
    const turns = readFileSync(new URL('../agent/turn-store.ts', import.meta.url), 'utf8');
    const here = readFileSync(new URL('../account-delete.ts', import.meta.url), 'utf8');
    assert.match(gate, /const KEY_USER = \(address: string\) => `changuito:user-turns:\$\{address\}`/);
    assert.match(here, /`changuito:user-turns:\$\{address\}`/);
    assert.match(turns, /const KEY = \(sessionId: string\) => `changuito:turn:\$\{sessionId\}`/);
    assert.match(here, /`changuito:turn:\$\{sessionId\}`/);
  });

  it('refuses without a session and without the confirm string', async () => {
    const { POST } = await import('../../app/api/account/delete/route.ts');
    const { mintUserToken } = await import('../login-gate.ts');
    const { USER_COOKIE } = await import('../login-constants.ts');
    const open = await POST(new Request('https://sol.changuito.me/api/account/delete', { method: 'POST' }));
    assert.equal(open.status, 401);

    const cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(ADDRESS, SECRET))}`;
    const wrong = await POST(
      new Request('https://sol.changuito.me/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ confirm: 'no' }),
      }),
    );
    assert.equal(wrong.status, 400);
    assert.equal(wrong.headers.get('set-cookie'), null);
  });

  it('clears the encrypted profile, the memory checkout and the session', async () => {
    const { POST } = await import('../../app/api/account/delete/route.ts');
    const { mintUserToken } = await import('../login-gate.ts');
    const { USER_COOKIE } = await import('../login-constants.ts');
    const { getProfile, saveProfile } = await import('../profile.ts');

    await saveProfile(ADDRESS, { email: 'a@example.com', password: 'secret-pass', dni: '30123456', postcode: 'C1425' });
    await saveProfile(OTHER, { email: 'b@example.com', postcode: 'B1602' });
    const checkouts = ((globalThis as { __chgCheckouts?: Map<string, { buyer: string }> }).__chgCheckouts ??=
      new Map());
    checkouts.set('order-a', { buyer: ADDRESS });
    checkouts.set('order-b', { buyer: OTHER });

    const cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(ADDRESS, SECRET))}`;
    const res = await POST(
      new Request('https://sol.changuito.me/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ confirm: 'delete-my-changuito-account' }),
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; privy: string; durable: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.privy, 'skipped');
    assert.equal(body.durable, false);
    assert.match(res.headers.get('set-cookie') ?? '', /chg_user=;/);
    assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal(await getProfile(ADDRESS), undefined);
    assert.equal((await getProfile(OTHER))?.email, 'b@example.com');
    assert.equal(checkouts.has('order-a'), false);
    assert.equal(checkouts.get('order-b')?.buyer, OTHER);
  });

  it('refuses a production delete when there is no database, and does not clear the cookie', async () => {
    const { POST } = await import('../../app/api/account/delete/route.ts');
    const { mintUserToken } = await import('../login-gate.ts');
    const { USER_COOKIE } = await import('../login-constants.ts');
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(ADDRESS, SECRET))}`;
      const res = await POST(
        new Request('https://sol.changuito.me/api/account/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ confirm: 'delete-my-changuito-account' }),
        }),
      );
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('set-cookie'), null);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
