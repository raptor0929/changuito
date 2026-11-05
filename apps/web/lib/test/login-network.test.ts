import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loginNetwork, type PollarKeys } from '../pollar.ts';

const keys = (partial: Partial<PollarKeys>): PollarKeys => ({
  testnet: '',
  mainnet: '',
  ...partial,
});

describe('loginNetwork', () => {
  it('picks testnet when only the testnet key is set', () => {
    assert.equal(loginNetwork(keys({ testnet: 'pk_test' })), 'testnet');
  });

  it('picks mainnet when only the mainnet key is set', () => {
    assert.equal(loginNetwork(keys({ mainnet: 'pk_main' })), 'mainnet');
  });

  it('RULE: testnet wins when both keys are set', () => {
    // A mainnet key left behind must never turn a D1 deployment into mainnet.
    assert.equal(loginNetwork(keys({ testnet: 'pk_test', mainnet: 'pk_main' })), 'testnet');
  });

  it('returns null when neither key is set', () => {
    assert.equal(loginNetwork(keys({})), null);
  });
});
