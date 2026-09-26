import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEPLOYMENTS } from '../deployments.ts';
import {
  canDeposit,
  depositAddress,
  depositAsset,
  depositAssetFor,
  isMemo,
  MEMO_LENGTH,
  mintMemo,
} from '../deposit.ts';
import { networkAccess } from '../network-access.ts';

const G = 'GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK';
const C = 'CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557';

describe('deposit asset', () => {
  it('RULE: is never an asset Horizon cannot show us', () => {
    // The whole deposit is "a payment arrived carrying this memo", and only a
    // classic payment has either. testnet USDC is a Soroban token with no
    // issuer, so asking for it would be asking for something unobservable.
    for (const net of ['testnet', 'mainnet'] as const) {
      const asset = depositAsset(net);
      const issuerless = asset.issuer === null;
      assert.equal(issuerless, !DEPLOYMENTS[net].usdcIssuer, `${net}`);
      if (issuerless) assert.equal(asset.code, 'XLM');
    }
  });

  it('is native XLM on the test network today', () => {
    assert.deepEqual(depositAsset('testnet'), { code: 'XLM', issuer: null });
  });

  it('becomes the classic asset the moment an issuer exists', () => {
    // The branch mainnet will take after a deploy, exercised today through
    // the pure half. Without this, the USDC path ships untested and is first
    // run by a shopper sending real money.
    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    assert.deepEqual(depositAssetFor('USDC', issuer), { code: 'USDC', issuer });
    assert.deepEqual(depositAssetFor('USDC', ''), { code: 'XLM', issuer: null });
    assert.deepEqual(depositAssetFor('USDC', null), { code: 'XLM', issuer: null });
  });
});

describe('deposit address', () => {
  it('reads the network it was asked about', () => {
    const env = { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: G, DEPOSIT_ADDRESS_MAINNET: '' } as NodeJS.ProcessEnv;
    assert.equal(depositAddress('testnet', env), G);
    assert.equal(depositAddress('mainnet', env), null);
  });

  it('RULE: refuses anything that is not an account', () => {
    // A shopper is told to send money here. A typo that survives this check
    // is money sent into nothing, and nobody finds out until they ask.
    for (const bad of ['', '   ', 'not-an-address', C, G.slice(0, -1)]) {
      assert.equal(depositAddress('testnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: bad } as NodeJS.ProcessEnv), null, bad);
    }
  });

  it('tolerates whitespace and case, the way a pasted value arrives', () => {
    const env = { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: `  ${G.toLowerCase()}\n` } as NodeJS.ProcessEnv;
    assert.equal(depositAddress('testnet', env), G);
  });

  it('canDeposit is exactly "is there an address"', () => {
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_MAINNET: G } as NodeJS.ProcessEnv), true);
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
  });
});

describe('the deposit opens modo real without a deploy', () => {
  it('RULE: an address to pay into makes mainnet usable with no contracts', () => {
    // This is the point of splitting canDeposit off isConfigured. Mainnet has
    // no escrow and is not getting one yet; the mode switch still has to be
    // reachable, or the whole flow is a door onto a wall.
    const env = {
      NODE_ENV: 'production',
      REAL_MODE_OPEN_TO_ALL: '1',
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.deepEqual(networkAccess(G, 'mainnet', env), {
      mode: 'public',
      allowed: true,
      configured: true,
      usable: true,
    });
  });

  it('RULE: and no address still means no', () => {
    const env = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', env).usable, false);
  });

  it('RULE: the allowlist is still the wall, address or not', () => {
    // Opening the deposit must not have opened the gate. An account that is
    // not on the list is refused even with somewhere to pay.
    const env = {
      NODE_ENV: 'production',
      REAL_MODE_ALLOWLIST_ADDRESSES: C,
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', env).allowed, false);
    assert.equal(networkAccess(G, 'mainnet', env).usable, false);
  });
});

describe('the memo', () => {
  it('is short enough to survive MEMO_TEXT and to be retyped', () => {
    // 28 bytes is the ledger's limit; 8 is what someone will copy by hand
    // into a wallet without losing their place.
    assert.ok(MEMO_LENGTH <= 28);
    const memo = mintMemo();
    assert.equal(memo.length, MEMO_LENGTH);
    assert.ok(isMemo(memo));
  });

  it('RULE: has no character that reads as another', () => {
    // It gets retyped off a screen. 0/O, 1/I/l are the pairs that cost an
    // afternoon, so the alphabet has none of them.
    let all = '';
    for (let i = 0; i < 500; i += 1) all += mintMemo();
    assert.doesNotMatch(all, /[01OIL]/);
  });

  it('rejects what is not one', () => {
    for (const bad of ['', 'ABC', 'ABCDEFGHI', 'ABCDEFG0', 'abcdefgh', null, 42, undefined]) {
      assert.equal(isMemo(bad), false, String(bad));
    }
  });

  it('spreads across the alphabet', () => {
    // A generator that returns the same memo twice puts two orders on one
    // payment, and the second shopper gets the first one's groceries.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(mintMemo());
    assert.ok(seen.size > 1990, `only ${seen.size} distinct`);
  });
});
