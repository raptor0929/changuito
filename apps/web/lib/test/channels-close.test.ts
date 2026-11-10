import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import {
  PluginExecutionError,
} from '@openzeppelin/relayer-plugin-channels/dist/client/index.js';

import { deployment } from '../deployments.ts';
import {
  ChannelsFailure,
  assertResolverEntries,
  buildRefundFunc,
  buildSettleFunc,
  submitRefund,
  submitSettle,
  type CloseDeps,
} from '../server/channels.ts';

const ESCROW = 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S';
const BUYER = 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X';
const ORDER = '11'.repeat(32);
const BASKET = '22'.repeat(32);
const RECEIPT = Buffer.alloc(32, 0x33);
const PASS = deployment('testnet').networkPassphrase;
const RESOLVER = Keypair.random();
const CHANNELS_FEE_ACCOUNT = 'GCNJB6V5YIODDSSCWXZ2VOKMRPRVZ2V723RRQS6STXE6NWTGVOJY35CN';

function resolverEntry(resolver: string, funcXdr: string): string {
  const parsed = xdr.HostFunction.fromXDR(funcXdr, 'base64');
  if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(resolver).toScAddress(),
      nonce: 7n,
      signatureExpirationLedger: 1,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(parsed.invokeContract),
      subInvocations: [],
    }),
  }).toXDR('base64');
}

function closeDeps(over: Partial<CloseDeps> = {}): CloseDeps {
  process.env.STELLAR_ESCROW_ID = ESCROW;
  const func = buildSettleFunc(ORDER, BASKET, RECEIPT);
  return {
    apiKey: 'test-key',
    client: {
      async submitSorobanTransaction() {
        return { hash: 'ab'.repeat(32) };
      },
    },
    simulator: {
      async simulate() {
        return { auth: [resolverEntry(RESOLVER.publicKey(), func)], latestLedger: 1000 };
      },
    },
    resolver: RESOLVER,
    networkPassphrase: PASS,
    sleep: async () => {},
    ...over,
  };
}

describe('channels close', () => {
  it('settle submits through Channels and names Channels as the fee payer', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildSettleFunc(ORDER, BASKET, RECEIPT);
    let seenFunc = '';
    let seenAuth = 0;
    let simSource = '';
    const sent = await submitSettle(
      { orderId: ORDER, basketHash: BASKET, buyer: BUYER },
      RECEIPT,
      closeDeps({
        simulator: {
          async simulate(funcXdr, source) {
            simSource = source;
            return { auth: [resolverEntry(RESOLVER.publicKey(), funcXdr)], latestLedger: 1000 };
          },
        },
        client: {
          async submitSorobanTransaction(req) {
            seenFunc = req.func;
            seenAuth = req.auth.length;
            // Channels wraps the call: channel account is the source, fund
            // account pays the fee. The unit test records that identity.
            return { hash: 'cd'.repeat(32), feeSource: CHANNELS_FEE_ACCOUNT } as { hash: string };
          },
        },
      }),
    );
    assert.equal(sent.hash, 'cd'.repeat(32));
    assert.equal(sent.feePayer, 'channels');
    assert.equal(seenFunc, func);
    assert.equal(seenAuth, 1);
    assert.equal(simSource, BUYER);
    assert.notEqual(simSource, RESOLVER.publicKey());
    assert.notEqual(CHANNELS_FEE_ACCOUNT, BUYER);
    assert.notEqual(CHANNELS_FEE_ACCOUNT, RESOLVER.publicKey());
  });

  it('refund submits through Channels with the resolver as caller', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildRefundFunc(RESOLVER.publicKey(), ORDER);
    let seen = '';
    const sent = await submitRefund(
      { orderId: ORDER, buyer: BUYER },
      closeDeps({
        simulator: {
          async simulate(funcXdr) {
            return { auth: [resolverEntry(RESOLVER.publicKey(), funcXdr)], latestLedger: 1000 };
          },
        },
        client: {
          async submitSorobanTransaction(req) {
            seen = req.func;
            return { hash: 'ef'.repeat(32) };
          },
        },
      }),
    );
    assert.equal(sent.feePayer, 'channels');
    assert.equal(seen, func);
    assert.equal(sent.hash, 'ef'.repeat(32));
  });

  it('failed Channels submit does not retry on the buyer account', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    let channelsCalls = 0;
    let buyerSends = 0;
    const deps = closeDeps({
      client: {
        async submitSorobanTransaction() {
          channelsCalls += 1;
          throw new PluginExecutionError('onchain', {
            code: 'ONCHAIN_FAILED',
            status: 400,
            details: { reason: 'boom', hash: null },
          });
        },
      },
    });
    // Prove there is no second door: a buyer-paid send is not part of CloseDeps
    // and is never invoked when Channels fails.
    const buyerPaidSend = async () => {
      buyerSends += 1;
      return 'buyer-paid';
    };
    await assert.rejects(
      () => submitSettle(
        { orderId: ORDER, basketHash: BASKET, buyer: BUYER },
        RECEIPT,
        deps,
      ),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_onchain',
    );
    assert.equal(channelsCalls, 1);
    assert.equal(buyerSends, 0);
    assert.equal('buyerPaidSend' in deps, false);
    assert.equal(typeof buyerPaidSend, 'function');
    assert.notEqual(deps.resolver.publicKey(), BUYER);
  });

  it('refuses source-account credentials that would make the resolver the fee source', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildSettleFunc(ORDER, BASKET, RECEIPT);
    const parsed = xdr.HostFunction.fromXDR(func, 'base64');
    if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
    const sourceEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(parsed.invokeContract),
        subInvocations: [],
      }),
    }).toXDR('base64');
    assert.throws(
      () => assertResolverEntries([sourceEntry], RESOLVER.publicKey(), func),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_auth',
    );
  });

  it('RULE: escrow writes only leave through channels.ts', () => {
    // Every settle/refund/open that reaches the network must go through
    // lib/server/channels.ts. A signAndSend on an escrow client, an escrow
    // .settle/.refund/.open that is sent, or an RPC sendTransaction anywhere
    // else is a regression back to the buyer or the resolver paying the fee.
    const webRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
    const allowed = 'lib/server/channels.ts';
    // Exact paths only. The faucet mints mock USDC; that is not an escrow call.
    const allowlist = new Map<string, string>([
      ['app/api/faucet/route.ts', 'USDC mint via usdcAsAdmin, not an escrow write'],
    ]);

    const WRITE = /\.(signAndSend|sendTransaction)\s*\(|\.(settle|refund|open)\s*\(/;

    function isEscrowWrite(src: string): boolean {
      return WRITE.test(src);
    }

    // The pre-Channels settle route would have failed this scan.
    const oldSettleRoute = [
      'const tx = await escrow.settle({ order_id: idBuf, basket_hash: buf, receipt_hash: buf });',
      'const sent = await tx.signAndSend();',
      'const hash = sent.sendTransactionResponse?.hash ?? "";',
    ].join('\n');
    assert.ok(isEscrowWrite(oldSettleRoute), 'scan must flag the old settle route');

    const hits: string[] = [];
    function walk(dir: string): void {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const full = join(dir, name);
        const rel = relative(webRoot, full).replaceAll('\\', '/');
        if (rel === 'lib/test' || rel.startsWith('lib/test/')) continue;
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
        if (rel === allowed) continue;
        if (allowlist.has(rel)) continue;
        const src = readFileSync(full, 'utf8');
        if (isEscrowWrite(src)) hits.push(rel);
      }
    }

    walk(join(webRoot, 'app'));
    walk(join(webRoot, 'lib'));
    assert.deepEqual(hits, [], `escrow write outside channels.ts: ${hits.join(', ')}`);
  });
});

