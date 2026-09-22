import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  FREE_TURNS,
  FREE_TURNS_PER_IP,
  __resetTurnCounterForTests,
  guestChatVerdict,
  mintUserToken,
  verifyUserToken,
  guestTurnCounter,
  LOGIN_REQUIRED_MESSAGE,
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

  it('login required copy is rioplatense', () => {
    assert.match(LOGIN_REQUIRED_MESSAGE, /iniciá sesión/i);
    assert.match(LOGIN_REQUIRED_MESSAGE, /Changuito/);
  });
});
