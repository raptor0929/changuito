import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Address, xdr } from '@stellar/stellar-sdk';

import { contractIds } from '../contract-ids.ts';
import { DEPLOYMENTS } from '../deployments.ts';
import { DEFAULT_TIMEOUT_SECS } from '../order.ts';
import {
  assertBuyerEntries,
  buildOpenFuncForBuyer,
  ChannelsFailure,
  mapChannelsError,
  prepareOpen,
  setAuthExpiry,
  submitOpen,
  type ChannelsDeps,
  type OpenFields,
} from '../server/channels.ts';

const ESCROW = 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S';
const BUYER = 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X';
const OTHER = 'GBXBAOFWG4Y4ZQEDXH73BACYYCE7ODSKXHLXYVRPLJOYFRDCPWHGYGN5';
const ORDER = '11'.repeat(32);
const BASKET = '22'.repeat(32);

function input(over: Partial<OpenFields> = {}): OpenFields {
  return {
    orderId: ORDER,
    amount: '1000000',
    basketHash: BASKET,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    contractId: ESCROW,
    method: 'open',
    network: 'testnet',
    ...over,
  };
}

function entry(buyer: string, funcXdr: string, kind: 'address' | 'source' = 'address'): string {
  const parsed = xdr.HostFunction.fromXDR(funcXdr, 'base64');
  if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
  const invoke = parsed.invokeContract;
  const transfer = new xdr.InvokeContractArgs({
    contractAddress: new Address(contractIds('testnet').usdcId).toScAddress(),
    functionName: 'transfer',
    args: [],
  });
  const credentials = kind === 'source'
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(buyer).toScAddress(),
      nonce: 1n,
      signatureExpirationLedger: 1,
      signature: xdr.ScVal.scvVoid(),
    }));
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
      subInvocations: [
        new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(transfer),
          subInvocations: [],
        }),
      ],
    }),
  }).toXDR('base64');
}

function deps(over: Partial<ChannelsDeps> = {}): ChannelsDeps {
  return {
    apiKey: 'test-key',
    client: { async submitSorobanTransaction() { return { hash: 'ab'.repeat(32) }; } },
    simulator: { async simulate() { return { auth: [], latestLedger: 1000 }; } },
    loadRecord: async () => null,
    readOpened: async () => false,
    sleep: async () => {},
    ...over,
  };
}

describe('channels open', () => {
  it('targets the runtime escrow, not the recorded one', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const parsed = xdr.HostFunction.fromXDR(buildOpenFuncForBuyer(input(), BUYER), 'base64');
    if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
    const contract = Address.fromScAddress(parsed.invokeContract.contractAddress).toString();
    assert.equal(contract, ESCROW);
    assert.notEqual(contract, DEPLOYMENTS.testnet.escrowId);
    assert.equal(String(parsed.invokeContract.functionName), 'open');
  });

  it('rejects a contract id that is not the runtime one', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    assert.throws(
      () => buildOpenFuncForBuyer(input({ contractId: DEPLOYMENTS.testnet.escrowId }), BUYER),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 400,
    );
  });

  it('refuses mainnet', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    assert.throws(
      () => buildOpenFuncForBuyer(input({ network: 'mainnet' }), BUYER),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_mainnet',
    );
  });

  it('checks the buyer entry and rejects the wrong shapes', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    assert.doesNotThrow(() => assertBuyerEntries([entry(BUYER, func)], BUYER, func));
    assert.throws(() => assertBuyerEntries([entry(OTHER, func)], BUYER, func), /autorización/);
    assert.throws(() => assertBuyerEntries([entry(BUYER, func, 'source')], BUYER, func), /autorización/);
    const other = buildOpenFuncForBuyer(input({ amount: '2' }), BUYER);
    assert.throws(() => assertBuyerEntries([entry(BUYER, other)], BUYER, func), /autorización/);
    assert.throws(() => assertBuyerEntries([entry(BUYER, func), entry(BUYER, func)], BUYER, func), /autorización/);
  });

  it('sets the signature expiry sixty ledgers ahead', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const stamped = setAuthExpiry(entry(BUYER, func), 1060);
    const parsed = xdr.SorobanAuthorizationEntry.fromXDR(stamped, 'base64');
    if (parsed.credentials.type !== 'sorobanCredentialsAddress') throw new Error('not an address');
    assert.equal(parsed.credentials.address.signatureExpirationLedger, 1060);
  });

  it('prepare returns the quoted entry and an existing signature', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const prepared = await prepareOpen(input(), BUYER, deps({
      simulator: { async simulate() { return { auth: [entry(BUYER, func)], latestLedger: 1000 }; } },
    }));
    assert.equal(prepared.kind, 'sign');
    if (prepared.kind !== 'sign') return;
    assert.equal(prepared.validUntilLedger, 1060);
    const again = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({ buyer: BUYER, amount: '1000000', basketHash: BASKET, openSig: 'cd'.repeat(32) }),
      simulator: { async simulate() { throw new Error('should not simulate'); } },
    }));
    assert.deepEqual(again, { kind: 'opened', hash: 'cd'.repeat(32) });
  });

  it('prepare rejects a record that does not match the buyer or the quote', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({
        loadRecord: async () => ({ buyer: OTHER, amount: '1000000', basketHash: BASKET }),
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 409,
    );
  });

  it('returns 503 when the key is unset', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ apiKey: undefined })),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 503 && err.code === 'channels_unconfigured',
    );
  });

  it('submit rebuilds the call and ignores any other function', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let seen = '';
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      client: { async submitSorobanTransaction(req) { seen = req.func; return { hash: 'ab'.repeat(32) }; } },
    }));
    assert.equal(seen, func);
    assert.equal(sent.hash, 'ab'.repeat(32));
  });

  it('maps each channels failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const signed = [entry(BUYER, func)];
    const cases: Array<[string, string, number, number]> = [
      ['FEE_LIMIT_EXCEEDED', 'channels_fee_cap', 503, 1],
      ['POOL_CAPACITY', 'channels_pool', 503, 3],
      ['AUTH_EXPIRY_TOO_SHORT', 'channels_auth_expiry', 409, 1],
      ['SIMULATION_FAILED account missing', 'channels_account', 409, 1],
      ['SIMULATION_FAILED balance', 'channels_balance', 409, 1],
      ['SIMULATION_SIGNED_AUTH_VALIDATION_FAILED', 'channels_auth', 400, 1],
      ['ONCHAIN_FAILED', 'channels_exists', 409, 1],
    ];
    for (const [text, code, status, calls] of cases) {
      let n = 0;
      await assert.rejects(
        () => submitOpen(input(), BUYER, signed, deps({
          client: { async submitSorobanTransaction() { n += 1; throw { message: text }; } },
        })),
        (err: unknown) => err instanceof ChannelsFailure && err.code === code && err.status === status,
      );
      assert.equal(n, calls, text);
    }
    const waiting = mapChannelsError({ message: 'WAIT_TIMEOUT' });
    assert.equal(waiting.code, 'channels_wait');
    await assert.rejects(
      () => submitOpen(input(), BUYER, signed, deps({
        readOpened: async () => true,
        client: { async submitSorobanTransaction() { throw { message: 'WAIT_TIMEOUT' }; } },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
  });
});

describe('channels route', () => {
  const route = readFileSync(join(import.meta.dirname, '../../app/api/checkout/channels/route.ts'), 'utf8');

  it('does not accept a host function from the browser', () => {
    assert.doesNotMatch(route, /body\.func/);
    assert.doesNotMatch(route, /func:/);
  });
});
