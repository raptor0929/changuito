import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { freighterNetworkId } from '../freighter-gate.ts';

describe('freighterNetworkId', () => {
  it('maps Freighter\'s TESTNET / PUBLIC vocabulary onto ours', () => {
    assert.equal(freighterNetworkId('TESTNET'), 'testnet');
    assert.equal(freighterNetworkId('PUBLIC'), 'mainnet');
    assert.equal(freighterNetworkId('mainnet'), 'mainnet');
  });

  it('refuses anything unrecognised', () => {
    assert.equal(freighterNetworkId(''), null);
    assert.equal(freighterNetworkId('STANDALONE'), null);
  });
});
