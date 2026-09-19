import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COOLDOWN_MS,
  ENOUGH_UNITS,
  GRANT_UNITS,
  faucetVerdict,
} from '../faucet-policy.ts';

const now = 1_760_000_000_000;

describe('faucetVerdict', () => {
  it('funds an empty wallet', () => {
    const v = faucetVerdict({ balanceUnits: 0n, now });
    assert.deepEqual(v, { allow: true, amount: GRANT_UNITS });
  });

  it('stops once the wallet clearly has enough', () => {
    const v = faucetVerdict({ balanceUnits: ENOUGH_UNITS, now });
    assert.equal(v.allow, false);
    assert.match(v.allow === false ? v.reason : '', /suficiente/);
  });

  it('still funds a wallet that is merely low', () => {
    assert.equal(faucetVerdict({ balanceUnits: ENOUGH_UNITS - 1n, now }).allow, true);
  });

  it('holds a second request inside the cooldown, and says for how long', () => {
    const v = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - 10_000, now });
    assert.equal(v.allow, false);
    assert.equal(v.allow === false ? v.retryInMs : -1, COOLDOWN_MS - 10_000);
  });

  it('lets the next one through once the cooldown has passed', () => {
    assert.equal(faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - COOLDOWN_MS, now }).allow, true);
  });

  it('treats a clock that went backwards as too soon, not as permission', () => {
    // Two lambdas with skewed clocks, or a redeploy. The safe reading of "the
    // last grant is in the future" is to wait, not to mint.
    const v = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now + 5_000, now });
    assert.equal(v.allow, false);
    assert.equal(v.allow === false ? v.retryInMs : -1, COOLDOWN_MS);
  });

  it('grants less than it takes to be worth farming', () => {
    assert.ok(GRANT_UNITS < ENOUGH_UNITS, 'one grant should not cross the enough line');
  });
});
