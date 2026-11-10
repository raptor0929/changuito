import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerWallet, faucetAdmitted } from '../wallet-record.ts';

describe('faucetAdmitted', () => {
  const closed = { banned: false, faucetAllowed: false };

  it('follows the database flag or the row, and a ban wins', () => {
    assert.equal(faucetAdmitted(closed, true), true);
    assert.equal(faucetAdmitted({ ...closed, faucetAllowed: true }, false), true);
    assert.equal(faucetAdmitted({ banned: true, faucetAllowed: true }, true), false);
    assert.equal(faucetAdmitted(closed, false), false);
  });
});

describe('registerWallet without a database', () => {
  it('does not pretend a row was written', async () => {
    const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const standing = await registerWallet('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', env);
    assert.equal(standing.stored, false);
    assert.equal(standing.banned, false);
    assert.equal(standing.faucetAllowed, false);
    assert.equal(standing.network, 'testnet');
  });
});
