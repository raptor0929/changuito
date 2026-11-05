import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  modeForSession,
  modeKeepsRecords,
  sessionNetwork,
} from '../app-mode.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';

describe('sessionNetwork', () => {
  it('RULE: a guest lands on the default (testnet)', () => {
    assert.equal(sessionNetwork(false, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(false, 'mainnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(false, null, DEFAULT_NETWORK), 'testnet');
  });

  it('RULE: a session lands on the login network', () => {
    assert.equal(sessionNetwork(true, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(true, 'mainnet', DEFAULT_NETWORK), 'mainnet');
  });

  it('stays on the default when there is no login network at all', () => {
    assert.equal(sessionNetwork(true, null, DEFAULT_NETWORK), DEFAULT_NETWORK);
  });
});

describe('mode follows the session, not the network', () => {
  it('RULE: production on testnet is a valid state', () => {
    // Who pays is the session; which chain is the key. A signed-in shopper
    // on testnet is production — their wallet pays — and keeps records.
    assert.equal(modeForSession(true), 'production');
    assert.equal(sessionNetwork(true, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(modeKeepsRecords(modeForSession(true)), true);
  });

  it('RULE: preview never keeps records', () => {
    assert.equal(modeKeepsRecords(modeForSession(false)), false);
  });
});
