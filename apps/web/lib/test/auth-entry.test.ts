import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Address, Keypair, hash, xdr } from '@stellar/stellar-sdk';

import { AuthEntryError, preimageForWallet, walletAuthEntry } from '../auth-entry.ts';

const PASS = 'Test SDF Network ; September 2015';
const BUYER = 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X';

/**
 * The entry prepare returned on testnet. Freighter was handed this and
 * reported that the authorization entry could not be parsed.
 */
const LIVE = 'AAAAAgAAAAAAAAAAr6r0PO13xT7z3lcYqpq1TN9RCX39kFETQ0pTM7j8tVswi9SdoUPnYABWZA4AAAABAAAAAAAAAAE4EZeU91xxO8APFRTYMc8CkOaRGVpVJGTIFQiKjU5KtgAAAARvcGVuAAAABQAAABIAAAAAAAAAAK+q9Dztd8U+895XGKqatUzfUQl9/ZBRE0NKUzO4/LVbAAAADQAAACCS74fe2kNBXrbJg7kvEH8mQzHD1d6wo/5rWEsih6JPNAAAAAoAAAAAAAAAAAAAAAAGBqngAAAADQAAACBSma2vL/DO2iMVfDWeyMHaJzrcqcHjs5MYUxbp4/i1pQAAAAUAAAAAAAAOEAAAAAEAAAAAAAAAARz1kJxtXVIHEXfac3VcKRi+u6LoATwFXCiGvEQJLmwWAAAACHRyYW5zZmVyAAAAAwAAABIAAAAAAAAAAK+q9Dztd8U+895XGKqatUzfUQl9/ZBRE0NKUzO4/LVbAAAAEgAAAAE4EZeU91xxO8APFRTYMc8CkOaRGVpVJGTIFQiKjU5KtgAAAAoAAAAAAAAAAAAAAAAGBqngAAAAAA==';

function entryV2(buyer: string): string {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address('CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S').toScAddress(),
        functionName: 'open',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(buyer).toScAddress(),
        nonce: 7n,
        signatureExpirationLedger: 4321,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  }).toXDR('base64');
}

describe('auth entry for Freighter', () => {
  it('the live entry is ADDRESS_V2 and is not a preimage', () => {
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(LIVE, 'base64');
    assert.equal(entry.credentials.type, 'sorobanCredentialsAddressV2');
    assert.throws(() => xdr.HashIdPreimage.fromXDR(LIVE, 'base64'));
    const preimage = xdr.HashIdPreimage.fromXDR(preimageForWallet(LIVE, PASS), 'base64');
    assert.equal(preimage.type, 'envelopeTypeSorobanAuthorization');
  });

  it('builds the preimage Freighter parses and signs it back onto V1 credentials', () => {
    const signer = Keypair.random();
    const entry = entryV2(signer.publicKey());
    const preimage = preimageForWallet(entry, PASS);
    const parsed = xdr.HashIdPreimage.fromXDR(preimage, 'base64');
    assert.equal(parsed.type, 'envelopeTypeSorobanAuthorization');
    const signature = Buffer.from(signer.sign(hash(parsed.toXDR()))).toString('base64');
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(walletAuthEntry(entry, signature, PASS), 'base64');
    assert.equal(signed.credentials.type, 'sorobanCredentialsAddress');
    if (signed.credentials.type !== 'sorobanCredentialsAddress') return;
    assert.equal(signed.credentials.address.signatureExpirationLedger, 4321);
    assert.notEqual(signed.credentials.address.signature.toXDR('base64'), xdr.ScVal.scvVoid().toXDR('base64'));
  });

  it('rejects a signature that is not the buyers', () => {
    const entry = entryV2(BUYER);
    const preimage = preimageForWallet(entry, PASS);
    const parsed = xdr.HashIdPreimage.fromXDR(preimage, 'base64');
    const signature = Buffer.from(Keypair.random().sign(hash(parsed.toXDR()))).toString('base64');
    assert.throws(() => walletAuthEntry(entry, signature, PASS), AuthEntryError);
  });
});
