import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_NETWORK, NETWORK_IDS } from '../deployments.ts';
import { requestNetwork, servedNetworks } from '../server-network.ts';

describe('servedNetworks', () => {
  it('serves every network when there is no login key', () => {
    // No key must leave behaviour unchanged: the mainnet gates (allowlist,
    // proof, isConfigured) decide. Only a testnet key shrinks the set.
    assert.deepEqual(servedNetworks(null, DEFAULT_NETWORK), [...NETWORK_IDS]);
  });

  it('serves only the default when the login key is that network', () => {
    assert.deepEqual(servedNetworks('testnet', DEFAULT_NETWORK), ['testnet']);
  });

  it('serves every network when the login key is mainnet', () => {
    assert.deepEqual(servedNetworks('mainnet', DEFAULT_NETWORK), [...NETWORK_IDS]);
  });
});

describe('requestNetwork', () => {
  it('defaults an absent value to the fallback', () => {
    assert.deepEqual(requestNetwork(undefined, 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork(null, 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork('', 'testnet'), { ok: true, network: 'testnet' });
  });

  it('RULE: a testnet-only deployment refuses mainnet', () => {
    // The whole point of the choke point: never coerce to the default, never
    // reach DEPLOYMENTS.mainnet from a request that named the wrong chain.
    const refused = requestNetwork('mainnet', 'testnet', DEFAULT_NETWORK);
    assert.deepEqual(refused, { ok: false, error: 'network_not_served' });
  });

  it('accepts testnet when that is the login network', () => {
    assert.deepEqual(requestNetwork('testnet', 'testnet'), { ok: true, network: 'testnet' });
  });

  it('refuses an unknown string when unknown is refuse', () => {
    assert.deepEqual(requestNetwork('futurenet', 'testnet', DEFAULT_NETWORK, 'refuse'), {
      ok: false,
      error: 'network_not_served',
    });
  });

  it('coerces an unknown string to the fallback when unknown is default', () => {
    assert.deepEqual(requestNetwork('futurenet', 'testnet', DEFAULT_NETWORK, 'default'), {
      ok: true,
      network: 'testnet',
    });
    assert.deepEqual(requestNetwork('MAINNET', null, DEFAULT_NETWORK, 'default'), {
      ok: true,
      network: 'testnet',
    });
  });

  it('still refuses a recognized but unserved network under unknown=default', () => {
    assert.deepEqual(requestNetwork('mainnet', 'testnet', DEFAULT_NETWORK, 'default'), {
      ok: false,
      error: 'network_not_served',
    });
  });
});
