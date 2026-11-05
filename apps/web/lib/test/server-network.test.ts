import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_NETWORK } from '../deployments.ts';
import { requestNetwork, servedNetworks } from '../server-network.ts';

describe('servedNetworks', () => {
  it('always includes the default', () => {
    assert.deepEqual(servedNetworks(null, DEFAULT_NETWORK), ['testnet']);
    assert.deepEqual(servedNetworks('testnet', DEFAULT_NETWORK), ['testnet']);
  });

  it('adds mainnet only when that is the login network', () => {
    assert.deepEqual(servedNetworks('mainnet', DEFAULT_NETWORK), ['testnet', 'mainnet']);
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

  it('refuses an unknown string the same way', () => {
    assert.deepEqual(requestNetwork('futurenet', 'testnet'), {
      ok: false,
      error: 'network_not_served',
    });
  });
});
