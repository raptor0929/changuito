import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POLLAR_NETWORK, shortAddress } from '../pollar.ts';
import { DEPLOYMENTS } from '../deployments.ts';
import { addressKind } from '../stellar.ts';

describe('shortAddress', () => {
  it('keeps both ends, which are the parts a person compares', () => {
    assert.equal(shortAddress(DEPLOYMENTS.resolver), 'GBGM…HTFK');
  });

  it('leaves anything already short alone', () => {
    assert.equal(shortAddress('GABC'), 'GABC');
    assert.equal(shortAddress(''), '');
  });
});

describe('addressKind', () => {
  it('knows a classic account from a contract', () => {
    // Both turn up as wallets: a Pollar internal wallet is a G-address, a
    // passkey smart wallet is a deployed contract.
    assert.equal(addressKind(DEPLOYMENTS.resolver), 'account');
    assert.equal(addressKind(DEPLOYMENTS.escrowId), 'contract');
    assert.equal(addressKind(DEPLOYMENTS.usdcId), 'contract');
  });

  it('rejects anything else rather than handing it to RPC', () => {
    for (const bad of [
      '',
      'nonsense',
      'GBGM…HTFK', // the shortened form, pasted back in
      DEPLOYMENTS.resolver.slice(0, -1),
      `${DEPLOYMENTS.resolver}A`,
      'SDJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', // a secret
    ]) {
      assert.equal(addressKind(bad), null, `${bad.slice(0, 12)} was accepted`);
    }
  });

  it('never accepts a secret key, because that is a paste people make', () => {
    // S-addresses are the same alphabet and length as G-addresses. If one ever
    // reached a balance URL it would be in a server log within the second.
    const secret = 'SAVYLZCEWXGXYVLOPICDQRVUQ6ZVKEPTFFOLC6RGKCXZZLBGQAPXYTYD';
    assert.equal(addressKind(secret), null);
  });
});

describe('POLLAR_NETWORK', () => {
  it('matches the network the contracts are deployed on', () => {
    assert.equal(POLLAR_NETWORK, DEPLOYMENTS.network);
  });
});
