import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Account, Address, xdr } from '@stellar/stellar-sdk';
import {
  PluginExecutionError,
  PluginTransportError,
} from '@openzeppelin/relayer-plugin-channels/dist/client/index.js';

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
  stellarSimulator,
  submitOpen,
  type ChannelsDeps,
  type OpenFields,
  type SimulationRpc,
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
    findOpenHash: async () => null,
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
    const cases: Array<[unknown, string, number, number, string]> = [
      [new PluginExecutionError('fee', { code: 'FEE_LIMIT_EXCEEDED', status: 429, details: {} }), 'channels_fee_cap', 503, 1, 'fee'],
      [new PluginExecutionError('pool', { code: 'POOL_CAPACITY', status: 503, details: {} }), 'channels_pool', 503, 3, 'pool'],
      [new PluginExecutionError('expiry', { code: 'AUTH_EXPIRY_TOO_SHORT', status: 400, details: {} }), 'channels_auth_expiry', 409, 1, 'expiry'],
      [new PluginExecutionError('Simulation failed', { code: 'SIMULATION_FAILED', status: 400, details: { error: 'account not found', authMode: 'enforce' } }), 'channels_account', 409, 1, 'account'],
      [new PluginExecutionError('Simulation failed', { code: 'SIMULATION_FAILED', status: 400, details: { error: 'insufficient balance', authMode: 'enforce' } }), 'channels_balance', 409, 1, 'balance'],
      [new PluginExecutionError('auth', { code: 'SIMULATION_SIGNED_AUTH_VALIDATION_FAILED', status: 400, details: {} }), 'channels_auth', 400, 1, 'auth'],
      [new PluginExecutionError('host error', { code: 'ONCHAIN_FAILED', status: 400, details: { status: 'failed', reason: 'OrderExists', id: '1', hash: null, resultCode: 'OrderExists', labUrl: null } }), 'channels_onchain', 409, 1, 'onchain'],
    ];
    for (const [thrown, code, status, calls, label] of cases) {
      let n = 0;
      await assert.rejects(
        () => submitOpen(input(), BUYER, signed, deps({
          client: { async submitSorobanTransaction() { n += 1; throw thrown; } },
        })),
        (err: unknown) => err instanceof ChannelsFailure && err.code === code && err.status === status,
      );
      assert.equal(n, calls, label);
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

describe('channels structured errors', () => {
  const LANDED = 'ef'.repeat(32);

  function pluginExec(code: string, details: unknown = {}, message = code) {
    return new PluginExecutionError(message, { code, status: 400, details });
  }

  it('does not call a SIMULATION_FAILED without balance "No alcanza el USDC"', () => {
    const mapped = mapChannelsError(pluginExec(
      'SIMULATION_FAILED',
      { error: 'Simulation failed', authMode: 'enforce' },
      'Simulation failed',
    ));
    assert.equal(mapped.code, 'channels_sim');
    assert.doesNotMatch(mapped.message, /USDC/);
  });

  it('does not retry when details only contain 502 inside a number', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        saveAttempt: async () => { saved += 1; },
        client: {
          async submitSorobanTransaction() {
            n += 1;
            throw pluginExec('ONCHAIN_FAILED', {
              status: 'failed',
              reason: 'boom',
              id: '1',
              hash: null,
              resultCode: null,
              labUrl: null,
              ledger: 1502,
            });
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_onchain',
    );
    assert.equal(n, 1);
    assert.equal(saved, 0);
  });

  it('stores WAIT_TIMEOUT hash as openAttemptSig and returns it when the order landed', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const store: {
      buyer: string;
      amount: string;
      basketHash: string;
      orderId: string;
      openSig?: string;
      openAttemptSig?: string;
    } = { buyer: BUYER, amount: '1000000', basketHash: BASKET, orderId: ORDER };
    let opened = false;
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      loadRecord: async () => ({ ...store }),
      saveAttempt: async (_orderId, hash) => { store.openAttemptSig = hash; },
      recoverAttempt: async (rec) => {
        if (!rec.openSig && rec.openAttemptSig && opened) {
          store.openSig = rec.openAttemptSig;
          return { ...rec, openSig: rec.openAttemptSig };
        }
        return rec;
      },
      readOpened: async () => opened,
      client: {
        async submitSorobanTransaction() {
          opened = true;
          throw pluginExec('WAIT_TIMEOUT', { hash: LANDED }, 'WAIT_TIMEOUT');
        },
      },
    }));
    assert.equal(store.openAttemptSig, LANDED);
    assert.equal(sent.hash, LANDED);
  });

  it('submit returns an existing openSig without calling Channels', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      loadRecord: async () => ({
        orderId: ORDER,
        buyer: BUYER,
        amount: '1000000',
        basketHash: BASKET,
        openSig: LANDED,
      }),
      client: {
        async submitSorobanTransaction() {
          n += 1;
          return { hash: 'ab'.repeat(32) };
        },
      },
    }));
    assert.equal(sent.hash, LANDED);
    assert.equal(n, 0);
  });

  it('submit rejects a record that does not match the quote', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        loadRecord: async () => ({
          orderId: ORDER,
          buyer: OTHER,
          amount: '1000000',
          basketHash: BASKET,
        }),
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 409 && err.code === 'channels_record',
    );
  });

  it('retries PluginTransportError twice then answers 503', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        client: {
          async submitSorobanTransaction() {
            n += 1;
            throw new PluginTransportError('bad gateway', 502);
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_pool' && err.status === 503,
    );
    assert.equal(n, 3);
  });

  it('maps FEE_LIMIT_EXCEEDED from errorDetails.code without retrying', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        client: {
          async submitSorobanTransaction() {
            n += 1;
            throw pluginExec('FEE_LIMIT_EXCEEDED', {}, 'fee cap');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_fee_cap' && err.status === 503,
    );
    assert.equal(n, 1);
  });

  it('prepare recovers a landed openAttemptSig before simulating', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    let simulated = 0;
    const prepared = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({
        orderId: ORDER,
        buyer: BUYER,
        amount: '1000000',
        basketHash: BASKET,
        openAttemptSig: LANDED,
      }),
      recoverAttempt: async (rec) => ({ ...rec, openSig: rec.openAttemptSig }),
      simulator: {
        async simulate() {
          simulated += 1;
          return { auth: [], latestLedger: 1000 };
        },
      },
    }));
    assert.deepEqual(prepared, { kind: 'opened', hash: LANDED });
    assert.equal(simulated, 0);
  });

  it('prepare does not simulate again while confirmation is still pending', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    let simulated = 0;
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({
        loadRecord: async () => ({
          orderId: ORDER,
          buyer: BUYER,
          amount: '1000000',
          basketHash: BASKET,
          openAttemptSig: LANDED,
        }),
        recoverAttempt: async (rec) => rec,
        simulator: {
          async simulate() {
            simulated += 1;
            return { auth: [], latestLedger: 1000 };
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming' && err.hash === LANDED,
    );
    assert.equal(simulated, 0);
  });

  it('a failed on-chain open does not stick and the next prepare can simulate', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const failed = 'ab'.repeat(32);
    const store: { openAttemptSig?: string; openSig?: string } = {};
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        loadRecord: async () => ({
          orderId: ORDER, buyer: BUYER, amount: '1000000', basketHash: BASKET,
          openAttemptSig: store.openAttemptSig, openSig: store.openSig,
        }),
        saveAttempt: async (_orderId, hash) => { saved += 1; store.openAttemptSig = hash; },
        recoverAttempt: async (rec) => rec,
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('ONCHAIN_FAILED', {
              status: 'failed',
              reason: 'host error',
              id: 'tx-1',
              hash: failed,
              resultCode: 'txFailed',
              labUrl: null,
            }, 'host error');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_onchain',
    );
    assert.equal(saved, 0);
    assert.equal(store.openAttemptSig, undefined);
    let simulated = 0;
    const funcAgain = buildOpenFuncForBuyer(input(), BUYER);
    const prepared = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({
        orderId: ORDER, buyer: BUYER, amount: '1000000', basketHash: BASKET,
        openAttemptSig: store.openAttemptSig,
      }),
      recoverAttempt: async (rec) => rec,
      simulator: {
        async simulate() {
          simulated += 1;
          return { auth: [entry(BUYER, funcAgain)], latestLedger: 1000 };
        },
      },
    }));
    assert.equal(simulated, 1);
    assert.equal(prepared.kind, 'sign');
  });

  it('SIMULATION_FAILED OrderExists with a matching order is not a failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => true,
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('SIMULATION_FAILED', {
              error: 'HostError: Error(Contract, #1) OrderExists',
              authMode: 'enforce',
            }, 'Simulation failed');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
  });

  it('ONCHAIN_FAILED with no matching order is a plain failure and does not save the hash', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const failed = 'cd'.repeat(32);
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => false,
        saveAttempt: async () => { saved += 1; },
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('ONCHAIN_FAILED', {
              status: 'failed',
              reason: 'contract error',
              id: 'tx-2',
              hash: failed,
              resultCode: 'txFailed',
              labUrl: null,
            }, 'contract error');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_onchain'
        && err.hash === failed,
    );
    assert.equal(saved, 0);
  });

  it('transport then SIMULATION_FAILED with the order on chain is not a failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    let opened = false;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => opened,
        client: {
          async submitSorobanTransaction() {
            n += 1;
            if (n === 1) throw new PluginTransportError('bad gateway', 502);
            opened = true;
            throw pluginExec('SIMULATION_FAILED', {
              error: 'HostError: Error(Contract, #1) OrderExists',
              authMode: 'enforce',
            }, 'Simulation failed');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(n, 2);
  });

  it('WAIT_TIMEOUT with a null hash and the order on chain is not a failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => true,
        saveAttempt: async () => { saved += 1; },
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('WAIT_TIMEOUT', { id: 'sub-1', hash: null }, 'WAIT_TIMEOUT');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(saved, 0);
  });

  it('prepare checks the chain before simulating when there is no stored hash', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    let simulated = 0;
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({
        loadRecord: async () => null,
        readOpened: async () => true,
        simulator: {
          async simulate() {
            simulated += 1;
            return { auth: [], latestLedger: 1000 };
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(simulated, 0);
  });

  it('a successful submit stores the hash and the next prepare does not simulate', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const store: { openAttemptSig?: string; openSig?: string } = {};
    const record = () => ({
      orderId: ORDER, buyer: BUYER, amount: '1000000', basketHash: BASKET,
      openAttemptSig: store.openAttemptSig, openSig: store.openSig,
    });
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      loadRecord: async () => record(),
      saveAttempt: async (_orderId, hash) => { store.openAttemptSig = hash; },
      recoverAttempt: async (rec) => rec,
      client: { async submitSorobanTransaction() { return { hash: LANDED }; } },
    }));
    assert.equal(sent.hash, LANDED);
    assert.equal(store.openAttemptSig, LANDED);
    let simulated = 0;
    const prepared = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => record(),
      recoverAttempt: async (rec) => ({ ...rec, openSig: rec.openAttemptSig }),
      simulator: {
        async simulate() {
          simulated += 1;
          return { auth: [], latestLedger: 1000 };
        },
      },
    }));
    assert.deepEqual(prepared, { kind: 'opened', hash: LANDED });
    assert.equal(simulated, 0);
  });

  it('submit does not call Channels while confirmation is still pending', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        loadRecord: async () => ({
          orderId: ORDER, buyer: BUYER, amount: '1000000', basketHash: BASKET, openAttemptSig: LANDED,
        }),
        recoverAttempt: async (rec) => rec,
        client: {
          async submitSorobanTransaction() {
            n += 1;
            return { hash: 'ab'.repeat(32) };
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(n, 0);
  });
});

describe('channels live simulator', () => {
  const USDC = contractIds('testnet').usdcId;

  /** Shaped like testnet's answer for an open whose buyer holds no mock USDC. */
  const LOW_BALANCE = [
    'HostError: Error(Contract, #4)',
    '',
    'Event log (newest first):',
    `   0: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #4)], data:"escalating error to VM trap from failed host function call: call"`,
    `   1: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #4)], data:["contract call failed", transfer, [${BUYER}, ${ESCROW}, 1000000]]`,
    `   2: [Failed Diagnostic Event (not emitted)] contract:${USDC}, topics:[error, Error(Contract, #4)], data:["failing with contract error", 4]`,
  ].join('\n');

  const ORDER_EXISTS = [
    'HostError: Error(Contract, #3)',
    '',
    'Event log (newest first):',
    `   0: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #3)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"`,
  ].join('\n');

  /**
   * An RPC whose ledger header the installed SDK cannot decode, as testnet's
   * protocol 30 header is for SDK 17.1. Only simulateTransaction works.
   */
  function rpcStub(answer: (tx: unknown) => unknown): SimulationRpc {
    const stub = {
      async getAccount(id: string) { return new Account(id, '1'); },
      async getLatestLedger() { throw new Error('LedgerHeader.scpValue.ext.v: unknown enum value 3'); },
      async simulateTransaction(tx: unknown) { return answer(tx); },
    };
    return stub as unknown as SimulationRpc;
  }

  /** Protocol 30 testnet records the buyer's auth as `ADDRESS_V2`. */
  function entryV2(buyer: string, func: string): xdr.SorobanAuthorizationEntry {
    const legacy = xdr.SorobanAuthorizationEntry.fromXDR(entry(buyer, func), 'base64');
    if (legacy.credentials.type !== 'sorobanCredentialsAddress') throw new Error('not address credentials');
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(legacy.credentials.address),
      rootInvocation: legacy.rootInvocation,
    });
  }

  function simulated(func: string, latestLedger: number) {
    return {
      id: '1',
      latestLedger,
      events: [],
      _parsed: true,
      result: { auth: [entryV2(BUYER, func)], retval: xdr.ScVal.scvVoid() },
    };
  }

  it('prepare returns the buyer entries without asking for the latest ledger', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const simulator = stellarSimulator('testnet', rpcStub(() => simulated(func, 5000)));
    const out = await prepareOpen(input(), BUYER, deps({ simulator }));
    assert.equal(out.kind, 'sign');
    if (out.kind !== 'sign') return;
    assert.equal(out.validUntilLedger, 5060);
    assert.equal(out.entries.length, 1);
    assert.equal(out.func, func);
  });

  it('keeps ADDRESS_V2 credentials and sets their expiry', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const renewed = xdr.SorobanAuthorizationEntry.fromXDR(setAuthExpiry(entryV2(BUYER, func).toXDR('base64'), 4321), 'base64');
    assert.equal(renewed.credentials.type, 'sorobanCredentialsAddressV2');
    if (renewed.credentials.type !== 'sorobanCredentialsAddressV2') return;
    assert.equal(renewed.credentials.addressV2.signatureExpirationLedger, 4321);
    assert.doesNotThrow(() => assertBuyerEntries([renewed.toXDR('base64')], BUYER, func));
  });

  it('refuses ADDRESS_V2 credentials for anyone but the buyer', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    assert.throws(
      () => assertBuyerEntries([entryV2(OTHER, func).toXDR('base64')], BUYER, func),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_auth',
    );
  });

  it('refuses delegated credentials', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const legacy = xdr.SorobanAuthorizationEntry.fromXDR(entry(BUYER, func), 'base64');
    if (legacy.credentials.type !== 'sorobanCredentialsAddress') throw new Error('not address credentials');
    const delegated = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
        new xdr.SorobanAddressCredentialsWithDelegates({ addressCredentials: legacy.credentials.address, delegates: [] }),
      ),
      rootInvocation: legacy.rootInvocation,
    }).toXDR('base64');
    assert.throws(() => setAuthExpiry(delegated, 10), /autorización/);
    assert.throws(() => assertBuyerEntries([delegated], BUYER, func), /autorización/);
  });

  it('simulates from the resolver, not the buyer', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let source = '';
    const simulator = stellarSimulator('testnet', rpcStub((tx) => {
      source = (tx as { source: string }).source;
      return simulated(func, 5000);
    }));
    await prepareOpen(input(), BUYER, deps({ simulator }));
    assert.equal(source, DEPLOYMENTS.testnet.resolver);
  });

  it('calls a failed token transfer a balance problem', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const simulator = stellarSimulator('testnet', rpcStub(() => ({ id: '1', latestLedger: 5000, events: [], _parsed: true, error: LOW_BALANCE })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_balance'
        && err.message === 'No alcanza el USDC para este pedido.',
    );
  });

  it('calls the escrow refusing a known order id an existing order', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const simulator = stellarSimulator('testnet', rpcStub(() => ({ id: '1', latestLedger: 5000, events: [], _parsed: true, error: ORDER_EXISTS })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_exists',
    );
  });

  it('keeps an unknown host error off the screen', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const simulator = stellarSimulator('testnet', rpcStub(() => ({
      id: '1', latestLedger: 5000, events: [], _parsed: true, error: 'HostError: Error(WasmVm, InvalidAction)',
    })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_sim'
        && !/HostError|WasmVm/.test(err.message),
    );
  });

  it('gives a throw from the RPC its own code and the shopper copy', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const simulator = { async simulate(): Promise<never> { throw new Error('LedgerHeader.scpValue.ext.v: unknown enum value 3'); } };
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.status === 502
        && err.code === 'channels_rpc'
        && err.message === 'La red no pudo simular el pago.',
    );
  });
});
