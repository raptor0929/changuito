import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  signAuthEntryWith,
  signTransactionWith,
  type AuthEntryResult,
  type TxSignResult,
  type WalletSignClient,
} from '../wallet-signers.ts';

function fakeClient(overrides: Partial<WalletSignClient>): WalletSignClient {
  return {
    signAuthEntry: async () => ({ status: 'error', details: 'unset' }),
    signTx: async () => ({ status: 'error', details: 'unset' }),
    ...overrides,
  };
}

describe('signAuthEntryWith', () => {
  it('returns the signed auth entry when the wallet signs', async () => {
    const client = fakeClient({
      signAuthEntry: async () => ({
        status: 'signed',
        signedAuthEntry: 'signed-entry-xdr',
      }),
    });
    const result = await signAuthEntryWith(client, 'entry-xdr', { validUntilLedger: 100 });
    assert.deepEqual(result, {
      status: 'signed',
      signedAuthEntry: 'signed-entry-xdr',
    } satisfies AuthEntryResult);
  });

  it('returns an error when the wallet rejects, without throwing', async () => {
    const client = fakeClient({
      signAuthEntry: async () => ({
        status: 'error',
        details: 'User declined access',
      }),
    });
    const result = await signAuthEntryWith(client, 'entry-xdr', { validUntilLedger: 100 });
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
      assert.equal(result.details, 'User declined access');
    }
  });

  it('turns a thrown rejection into an error result', async () => {
    const client = fakeClient({
      signAuthEntry: async () => {
        throw new Error('User declined access');
      },
    });
    const result = await signAuthEntryWith(client, 'entry-xdr', { validUntilLedger: 100 });
    assert.deepEqual(result, {
      status: 'error',
      details: 'User declined access',
    });
  });

  it('surfaces a smart-wallet error the same way (no throw)', async () => {
    // Pollar returns status:error for passkey wallets; they cannot sign an entry.
    const client = fakeClient({
      signAuthEntry: async () => ({
        status: 'error',
        details: 'Smart wallets cannot sign auth entries',
      }),
    });
    const result = await signAuthEntryWith(client, 'entry-xdr', { validUntilLedger: 42 });
    assert.equal(result.status, 'error');
  });
});

describe('signTransactionWith', () => {
  it('returns the signed XDR when the wallet signs', async () => {
    const client = fakeClient({
      signTx: async () => ({ status: 'signed', signedXdr: 'signed-tx-xdr' }),
    });
    const result = await signTransactionWith(client, 'unsigned-xdr');
    assert.deepEqual(result, {
      status: 'signed',
      signedXdr: 'signed-tx-xdr',
    } satisfies TxSignResult);
  });

  it('returns an error when the wallet rejects, without throwing', async () => {
    const client = fakeClient({
      signTx: async () => ({ status: 'error', details: 'User declined access' }),
    });
    const result = await signTransactionWith(client, 'unsigned-xdr');
    assert.equal(result.status, 'error');
  });

  it('turns a thrown rejection into an error result', async () => {
    const client = fakeClient({
      signTx: async () => {
        throw new Error('User declined access');
      },
    });
    const result = await signTransactionWith(client, 'unsigned-xdr');
    assert.deepEqual(result, {
      status: 'error',
      details: 'User declined access',
    });
  });
});
