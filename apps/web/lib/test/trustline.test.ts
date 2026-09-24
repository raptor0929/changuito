import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEPLOYMENTS, NETWORK_IDS } from '../deployments.ts';
import type { AccountBalance } from '../stellar.ts';
import { trustlineFor, trustlineState, usdcAsset } from '../trustline.ts';

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const native: AccountBalance = { asset_type: 'native', balance: '10.0' };
const usdc = (issuer: string): AccountBalance => ({
  asset_type: 'credit_alphanum4',
  balance: '0.0',
  asset_code: 'USDC',
  asset_issuer: issuer,
});

describe('trustlines', () => {
  it('testnet has no issuer, so it has no trustline step', () => {
    // contracts/mock_usdc is a pure SEP-41 token. This is the whole reason
    // the app has worked for months without any of this code.
    assert.equal(DEPLOYMENTS.testnet.usdcIssuer, null);
    assert.equal(usdcAsset('testnet'), null);
    assert.equal(trustlineState([], 'testnet'), 'not-needed');
    assert.equal(trustlineState(null, 'testnet'), 'not-needed');
  });

  it('RULE: an unconfigured network never asks for a trustline it cannot name', () => {
    // Before the mainnet deploy `usdcIssuer` is '', and an empty issuer must
    // read as "nothing to open" rather than as an asset called USDC:''.
    for (const net of NETWORK_IDS) {
      const issuer = DEPLOYMENTS[net].usdcIssuer;
      if (issuer) continue;
      assert.equal(usdcAsset(net), null, `${net} has a falsy issuer but an asset`);
      assert.equal(trustlineState(null, net), 'not-needed');
    }
  });
});

describe('trustlineFor, on a token that has an issuer', () => {
  // Named directly rather than read from DEPLOYMENTS.mainnet, which is empty
  // until the deploy — a test that can only run afterwards guards nothing.
  const state = (balances: AccountBalance[] | null) => trustlineFor(balances, { code: 'USDC', issuer: ISSUER });

  it('an account holding the line is ok', () => {
    assert.equal(state([native, usdc(ISSUER)]), 'ok');
  });

  it('an account holding only XLM needs one', () => {
    assert.equal(state([native]), 'needed');
  });

  it('RULE: the same code from another issuer is not the same asset', () => {
    // USDC is four letters anybody can issue. Matching on the code alone
    // would call somebody else's token our money.
    assert.equal(state([native, usdc('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')]), 'needed');
  });

  it('RULE: an account that is not on the ledger has opted into nothing', () => {
    assert.equal(state(null), 'needed');
  });
});
