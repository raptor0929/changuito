import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerWallet, walletOpensFaucet } from '../wallet-record.ts';

describe('walletOpensFaucet', () => {
  const closed = { banned: false, faucetAllowed: false };

  it('opens the faucet from the config flag when the env list does not', () => {
    assert.equal(walletOpensFaucet(closed, true, 'faucet_disabled'), true);
    assert.equal(walletOpensFaucet({ ...closed, faucetAllowed: true }, false, 'faucet_not_allowed'), true);
  });

  it('stays closed for a banned wallet and for a refusal that is not the allowlist', () => {
    assert.equal(walletOpensFaucet({ banned: true, faucetAllowed: true }, true, 'faucet_disabled'), false);
    assert.equal(walletOpensFaucet(closed, true, 'faucet_not_on_network'), false);
    assert.equal(walletOpensFaucet(closed, false, 'faucet_disabled'), false);
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
