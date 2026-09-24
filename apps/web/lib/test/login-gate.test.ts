import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  clientIp,
  CounterUnavailable,
  FREE_TURNS,
  FREE_TURNS_PER_HUMAN,
  FREE_TURNS_PER_IP,
  __resetTurnCounterForTests,
  mintUserToken as mint,
  requireLoginOrFreeTurn,
  takeQuota,
  type TurnCounter,
  USER_TURNS_PER_HOUR,
  guestChatVerdict,
  mintUserToken,
  verifyUserToken,
  guestTurnCounter,
  LOGIN_CTA,
  LOGIN_REQUIRED_MESSAGE,
  loginGateBannerText,
  shouldShowLoginGate,
} from '../login-gate.ts';

describe('login-gate', () => {
  beforeEach(() => {
    __resetTurnCounterForTests();
  });

  it('FREE_TURNS is 3 and easy to spot', () => {
    assert.equal(FREE_TURNS, 3);
  });

  it('mints and verifies a user token', async () => {
    const secret = 'test-session-secret';
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const token = await mintUserToken(address, secret, 1_000_000, 60_000);
    const ok = await verifyUserToken(token, secret, 1_000_000);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.address, address);
    assert.equal((await verifyUserToken(token, secret, 1_100_000)).ok, false);
    assert.equal((await verifyUserToken(token, 'other', 1_000_000)).ok, false);
    assert.match(token, /^v2\./);
  });

  it('rejects the v1 cookies, which were minted without any proof', async () => {
    const secret = 'test-session-secret';
    const v2 = await mintUserToken('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', secret, 1_000_000, 60_000);
    const v1 = v2.slice(3); // same fields, old three-part shape
    assert.equal((await verifyUserToken(v1, secret, 1_000_000)).ok, false);
  });

  it('allows FREE_TURNS guest attempts then blocks', () => {
    for (let used = 0; used < FREE_TURNS; used++) {
      const v = guestChatVerdict({ loggedIn: false, sessionCount: used });
      assert.equal(v.allow, true, `turn ${used + 1} should allow`);
      assert.equal(v.turnsUsed, used + 1);
    }
    const blocked = guestChatVerdict({ loggedIn: false, sessionCount: FREE_TURNS });
    assert.equal(blocked.allow, false);
    assert.equal(blocked.reason, 'login_required');
  });

  it('logged-in users skip the counter', () => {
    const v = guestChatVerdict({ loggedIn: true, sessionCount: 99 });
    assert.equal(v.allow, true);
  });

  it('authenticated shopper sees no login banner even after the free turns', () => {
    for (const turnsUsed of [FREE_TURNS, 99]) {
      const banner = loginGateBannerText({ isAuthenticated: true, loginRequired: true, turnsUsed });
      assert.equal(shouldShowLoginGate({ isAuthenticated: true, loginRequired: true, turnsUsed }), false);
      assert.equal(banner, null);
    }
  });

  it('anonymous shopper still sees the login banner after 3 requests', () => {
    assert.equal(
      shouldShowLoginGate({ isAuthenticated: false, loginRequired: false, turnsUsed: FREE_TURNS }),
      true,
    );
    assert.equal(
      shouldShowLoginGate({ isAuthenticated: false, loginRequired: false, turnsUsed: FREE_TURNS - 1 }),
      false,
    );
    const banner = loginGateBannerText({
      isAuthenticated: false,
      loginRequired: true,
      turnsUsed: FREE_TURNS,
    });
    assert.equal(banner, LOGIN_REQUIRED_MESSAGE);
    assert.match(banner ?? '', /Para seguir, iniciá sesión/);
  });

  it('blocks when IP soft ceiling is hit', () => {
    const v = guestChatVerdict({
      loggedIn: false,
      sessionCount: 0,
      ipCount: FREE_TURNS_PER_IP,
    });
    assert.equal(v.allow, false);
    assert.equal(v.reason, 'ip_limit');
  });

  it('memory counter increments with TTL semantics', async () => {
    const store = guestTurnCounter();
    assert.equal(await store.get('s1'), 0);
    assert.equal(await store.incr('s1'), 1);
    assert.equal(await store.incr('s1'), 2);
    assert.equal(await store.incr('s1'), 3);
    assert.equal(await store.get('s1'), 3);
    assert.equal(await store.get('other'), 0);
  });

  it('blocks a guest who rotates sessionId on the same Turnstile pass', () => {
    const v = guestChatVerdict({ loggedIn: false, sessionCount: 0, humanCount: FREE_TURNS_PER_HUMAN });
    assert.equal(v.allow, false);
    assert.equal(v.reason, 'human_limit');
  });

  it('login required copy is rioplatense', () => {
    assert.match(LOGIN_REQUIRED_MESSAGE, /iniciá sesión/i);
    assert.match(LOGIN_REQUIRED_MESSAGE, /Changuito/);
    assert.equal(LOGIN_CTA, 'Iniciá sesión');
  });
});

const failing: TurnCounter = {
  kind: 'redis',
  get: async () => {
    throw new CounterUnavailable('down');
  },
  incr: async () => {
    throw new CounterUnavailable('down');
  },
};

const UUID = '00000000-0000-4000-8000-000000000000';
const prodEnv = { NODE_ENV: 'production', CHG_SESSION_SECRET: 'sess' } as NodeJS.ProcessEnv;
const chat = (headers: Record<string, string> = {}) => new Request('https://app.changuito.me/api/chat', { method: 'POST', headers });

describe('quotas fail closed', () => {
  beforeEach(() => __resetTurnCounterForTests());

  it('refuses a guest turn when the counter store is down', async () => {
    __resetTurnCounterForTests(failing);
    const res = await requireLoginOrFreeTurn(chat(), UUID, prodEnv);
    assert.equal(res?.status, 503);
  });

  it('refuses a signed-in turn when the counter store is down', async () => {
    __resetTurnCounterForTests(failing);
    const token = await mint('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'sess');
    const res = await requireLoginOrFreeTurn(chat({ cookie: `chg_user=${encodeURIComponent(token)}` }), UUID, prodEnv);
    assert.equal(res?.status, 503);
  });

  it('reports unavailable from takeQuota instead of allowing', async () => {
    assert.equal(await takeQuota('k', 1, 60, failing), 'unavailable');
  });

  it('caps a signed-in wallet per hour', async () => {
    const token = await mint('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'sess');
    const req = () => chat({ cookie: `chg_user=${encodeURIComponent(token)}` });
    for (let i = 0; i < USER_TURNS_PER_HOUR; i++) assert.equal(await requireLoginOrFreeTurn(req(), UUID, prodEnv), null);
    const res = await requireLoginOrFreeTurn(req(), UUID, prodEnv);
    assert.equal(res?.status, 429);
  });

  it('counts guests per Turnstile pass across sessions', async () => {
    const req = () => chat({ cookie: 'chg_human=same-pass' });
    let allowed = 0;
    for (let i = 0; i < FREE_TURNS_PER_HUMAN + 3; i++) {
      const session = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      if ((await requireLoginOrFreeTurn(req(), session, prodEnv)) === null) allowed++;
    }
    assert.equal(allowed, FREE_TURNS_PER_HUMAN);
  });
});

describe('clientIp', () => {
  const ip = (headers: Record<string, string>) => clientIp(new Request('https://x', { headers }));

  it('trusts the edge headers and never the first X-Forwarded-For', () => {
    assert.equal(ip({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }), '1.1.1.1');
    assert.equal(ip({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '9.9.9.9' }), '2.2.2.2');
    assert.equal(ip({ 'x-forwarded-for': '9.9.9.9' }), null);
  });
});
