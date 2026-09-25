import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, isConfigured } from '../deployments.ts';
import { denyNetwork, networkAccess, realModeAllowlist, realModeMode } from '../network-access.ts';

/**
 * The wall in front of modo real. Mirrors faucet-auth.test.ts, because the
 * module mirrors faucet-auth.ts — the difference is what it is guarding.
 */

const tester = Keypair.random();
const stranger = Keypair.random();

const prod = { NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv;
const empty = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

describe('real mode allowlist', () => {
  it('RULE: is disabled in production when nobody is on the list', () => {
    assert.equal(realModeMode(empty), 'disabled');
    assert.equal(realModeMode({ NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: ' , ' } as NodeJS.ProcessEnv), 'disabled');
  });

  it('is open outside production so a clone can try both modes', () => {
    assert.equal(realModeMode(dev), 'open');
  });

  it('uses the list whenever there is one, in any environment', () => {
    assert.equal(realModeMode(prod), 'allowlist');
    assert.equal(
      realModeMode({ NODE_ENV: 'development', REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv),
      'allowlist',
    );
  });

  it('RULE: REAL_MODE_OPEN_TO_ALL overrides the list, it does not lose to it', () => {
    const open = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(realModeMode(open), 'public');
    assert.equal(realModeMode({ ...prod, REAL_MODE_OPEN_TO_ALL: 'true' } as NodeJS.ProcessEnv), 'public');
    assert.equal(networkAccess(stranger.publicKey(), 'mainnet', open).allowed, true);
    assert.equal(denyNetwork(stranger.publicKey(), 'mainnet', open)?.error, isConfigured('mainnet') ? undefined : 'network_not_deployed');
  });

  it('is not opened by a flag set to a no-word', () => {
    for (const off of ['', 'false', '0', 'off']) {
      assert.equal(realModeMode({ NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: off } as NodeJS.ProcessEnv), 'disabled');
    }
  });

  it('RULE: opening modo real to everyone does not deploy anything', () => {
    // The flag answers "may this wallet", never "is there anything there".
    // With nothing on mainnet it opens a door onto a wall, and `usable` — the
    // conjunction the toggle reads — stays false for everybody.
    const open = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: 'yes' } as NodeJS.ProcessEnv;
    const access = networkAccess(stranger.publicKey(), 'mainnet', open);
    assert.equal(access.configured, isConfigured('mainnet'));
    assert.equal(access.usable, access.allowed && access.configured);
  });

  it('is its own switch, not the faucet\'s', () => {
    // Play money and a stranger opening an escrow with real USDC are not the
    // same decision, so one variable must never turn on the other.
    const faucetOnly = { NODE_ENV: 'production', FAUCET_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(realModeMode(faucetOnly), 'disabled');
  });

  it('reads commas, spaces and newlines, and drops what is not a G… address', () => {
    const list = realModeAllowlist({
      NODE_ENV: 'production',
      REAL_MODE_ALLOWLIST_ADDRESSES: `${tester.publicKey()},\n ${stranger.publicKey()} tester@example.com CABC`,
    } as NodeJS.ProcessEnv);
    assert.deepEqual([...list].sort(), [tester.publicKey(), stranger.publicKey()].sort());
  });

  it('RULE: a smart wallet address is not on any list — C… cannot sign SEP-53', () => {
    const c = 'CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557';
    assert.equal(realModeAllowlist({ NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: c } as NodeJS.ProcessEnv).size, 0);
  });
});

describe('networkAccess', () => {
  it('never gates the default network — it cannot spend anything', () => {
    for (const env of [prod, empty, dev]) {
      const access = networkAccess(stranger.publicKey(), DEFAULT_NETWORK, env);
      assert.equal(access.allowed, true, 'anyone may use modo prueba');
    }
  });

  it('separates "you may not" from "it is not up yet"', () => {
    const allowed = networkAccess(tester.publicKey(), 'mainnet', prod);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.configured, isConfigured('mainnet'));
    // `usable` is the one the toggle reads: both halves have to hold.
    assert.equal(allowed.usable, allowed.allowed && allowed.configured);
  });

  it('RULE: refuses a stranger in production', () => {
    assert.equal(networkAccess(stranger.publicKey(), 'mainnet', prod).allowed, false);
    assert.equal(networkAccess(tester.publicKey(), 'mainnet', empty).allowed, false);
  });

  it('is not fooled by whitespace or case around an allowlisted address', () => {
    assert.equal(networkAccess(` ${tester.publicKey().toLowerCase()} `, 'mainnet', prod).allowed, true);
  });
});

describe('denyNetwork', () => {
  it('lets the default network through for everybody', () => {
    assert.equal(denyNetwork(stranger.publicKey(), DEFAULT_NETWORK, empty), null);
  });

  it('RULE: tells a stranger only that they may not, never whether it is deployed', () => {
    const denial = denyNetwork(stranger.publicKey(), 'mainnet', prod);
    assert.equal(denial?.status, 403);
    assert.equal(denial?.error, 'network_not_allowed');
  });

  it('tells somebody allowed that it is not up yet, while it is not', () => {
    const denial = denyNetwork(tester.publicKey(), 'mainnet', prod);
    if (isConfigured('mainnet')) {
      assert.equal(denial, null);
    } else {
      assert.equal(denial?.error, 'network_not_deployed');
    }
  });

  it('speaks to a shopper, without naming a network', () => {
    for (const address of [stranger.publicKey(), tester.publicKey()]) {
      const denial = denyNetwork(address, 'mainnet', prod);
      if (!denial) continue;
      assert.match(denial.message, /modo real/);
      assert.doesNotMatch(denial.message, /mainnet|testnet|wallet|blockchain/i);
    }
  });
});
