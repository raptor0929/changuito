import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pollarEnabledOn, pollarNetwork, shortAddress } from '../pollar.ts';
import { DEFAULT_NETWORK, DEPLOYMENTS, NETWORK_IDS } from '../deployments.ts';
import { addressKind } from '../stellar.ts';

describe('shortAddress', () => {
  it('keeps both ends, which are the parts a person compares', () => {
    assert.equal(shortAddress(DEPLOYMENTS.testnet.resolver), 'GBGM…HTFK');
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
    assert.equal(addressKind(DEPLOYMENTS.testnet.resolver), 'account');
    assert.equal(addressKind(DEPLOYMENTS.testnet.escrowId), 'contract');
    assert.equal(addressKind(DEPLOYMENTS.testnet.usdcId), 'contract');
  });

  it('rejects anything else rather than handing it to RPC', () => {
    for (const bad of [
      '',
      'nonsense',
      'GBGM…HTFK', // the shortened form, pasted back in
      DEPLOYMENTS.testnet.resolver.slice(0, -1),
      `${DEPLOYMENTS.testnet.resolver}A`,
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

describe('pollarNetwork', () => {
  it('RULE: asks Pollar for the same chain the contracts are on', () => {
    // Pollar's wallet and our escrow have to agree, or the user signs a
    // transaction on one chain against a contract that lives on another. Our
    // ids and Pollar's happen to be the same two words; this keeps that a
    // fact we assert rather than one we assume.
    for (const net of NETWORK_IDS) {
      assert.equal(pollarNetwork(net), DEPLOYMENTS[net].id);
    }
  });

  it('defaults to the default network', () => {
    assert.equal(pollarNetwork(), pollarNetwork(DEFAULT_NETWORK));
  });

  it('reports per-network whether a key was configured', () => {
    // Pollar dashboard keys are network-scoped, so mainnet needs its own.
    // Nothing is asserted about the values — a fresh clone has neither.
    for (const net of NETWORK_IDS) {
      assert.equal(typeof pollarEnabledOn(net), 'boolean');
    }
  });
});
