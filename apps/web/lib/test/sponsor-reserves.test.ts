import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Keypair, Transaction } from '@stellar/stellar-sdk';

import { DEPLOYMENTS } from '../deployments.ts';
import { prepareSponsorship, submitSponsorship, type SponsorFlowDeps } from '../sponsor-flow.ts';
import {
  CIRCLE_TESTNET_USDC_CODE,
  CIRCLE_TESTNET_USDC_ISSUER,
  buildSponsorTransaction,
  expectedSponsorOps,
  sponsorNeed,
  summarizeSponsorOps,
} from '../sponsor-reserves.ts';
import type { AccountBalance } from '../stellar.ts';

/**
 * Transaction shape and already-sponsored no-op for classic sponsored
 * reserves. No Horizon, no friendbot, no real accounts.
 */

const sponsor = Keypair.random();
const user = Keypair.random();
const NETWORK = 'testnet' as const;

const NATIVE: AccountBalance = { asset_type: 'native', balance: '0.0000000' };
const CIRCLE_LINE: AccountBalance = {
  asset_type: 'credit_alphanum4',
  asset_code: CIRCLE_TESTNET_USDC_CODE,
  asset_issuer: CIRCLE_TESTNET_USDC_ISSUER,
  balance: '0.0000000',
};
const OTHER_LINE: AccountBalance = {
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: 'GCGV3225QTJFJ32KTPJNOR5SYANP4QWNUGKKGKVK7ILMK4QACZHJTGJB',
  balance: '1.0000000',
};

describe('sponsorNeed', () => {
  it('asks for create+trust when the account is missing', () => {
    assert.equal(sponsorNeed(null), 'create-and-trust');
  });

  it('asks for trust-only when the account exists without Circle USDC', () => {
    assert.equal(sponsorNeed([NATIVE]), 'trust-only');
    assert.equal(sponsorNeed([NATIVE, OTHER_LINE]), 'trust-only');
  });

  it('is ready when the Circle USDC trustline is already open', () => {
    assert.equal(sponsorNeed([NATIVE, CIRCLE_LINE]), 'ready');
  });
});

describe('sponsorOperations shape', () => {
  it('builds begin → createAccount(0) → changeTrust(Circle USDC) → end for a new account', () => {
    const expected = expectedSponsorOps({ userPublicKey: user.publicKey(), need: 'create-and-trust' });
    assert.deepEqual(expected, [
      { type: 'beginSponsoringFutureReserves', source: undefined, sponsoredId: user.publicKey() },
      {
        type: 'createAccount',
        source: undefined,
        destination: user.publicKey(),
        startingBalance: '0',
      },
      {
        type: 'changeTrust',
        source: user.publicKey(),
        asset: { code: CIRCLE_TESTNET_USDC_CODE, issuer: CIRCLE_TESTNET_USDC_ISSUER },
      },
      { type: 'endSponsoringFutureReserves', source: user.publicKey() },
    ]);

    const built = buildSponsorTransaction(
      {
        sponsorPublicKey: sponsor.publicKey(),
        sponsorSequence: '10',
        userPublicKey: user.publicKey(),
        need: 'create-and-trust',
        network: NETWORK,
      },
      sponsor,
    );
    assert.deepEqual(summarizeSponsorOps(built.operations), expected);
  });

  it('omits createAccount when the account already exists', () => {
    const expected = expectedSponsorOps({ userPublicKey: user.publicKey(), need: 'trust-only' });
    assert.deepEqual(
      expected.map((o) => o.type),
      ['beginSponsoringFutureReserves', 'changeTrust', 'endSponsoringFutureReserves'],
    );
    assert.equal(expected[1]?.asset?.issuer, CIRCLE_TESTNET_USDC_ISSUER);

    const built = buildSponsorTransaction(
      {
        sponsorPublicKey: sponsor.publicKey(),
        sponsorSequence: '10',
        userPublicKey: user.publicKey(),
        need: 'trust-only',
        network: NETWORK,
      },
      sponsor,
    );
    assert.deepEqual(summarizeSponsorOps(built.operations), expected);
  });

  it('survives an envelope round-trip with the same summary', () => {
    const built = buildSponsorTransaction(
      {
        sponsorPublicKey: sponsor.publicKey(),
        sponsorSequence: '10',
        userPublicKey: user.publicKey(),
        need: 'create-and-trust',
        network: NETWORK,
      },
      sponsor,
    );
    assert.equal(built.source, sponsor.publicKey());
    assert.equal(built.signatures.length, 1);

    const expected = expectedSponsorOps({ userPublicKey: user.publicKey(), need: 'create-and-trust' });
    assert.deepEqual(summarizeSponsorOps(built.operations), expected);

    const back = new Transaction(built.toXDR(), DEPLOYMENTS[NETWORK].networkPassphrase);
    assert.deepEqual(summarizeSponsorOps(back.operations), expected);
  });
});

describe('already-sponsored no-op', () => {
  function deps(balances: AccountBalance[] | null, over: Partial<SponsorFlowDeps> = {}): SponsorFlowDeps {
    return {
      sponsor,
      loadBalances: async () => balances,
      loadAccount: async () => {
        throw new Error('loadAccount must not run on a no-op');
      },
      submitTransaction: async () => {
        throw new Error('submitTransaction must not run on a no-op');
      },
      ...over,
    };
  }

  it('prepare returns ready without building or submitting', async () => {
    const prepared = await prepareSponsorship(user.publicKey(), NETWORK, deps([NATIVE, CIRCLE_LINE]));
    assert.deepEqual(prepared, { status: 'ready', need: 'ready' });
  });

  it('submit returns ready without submitting again', async () => {
    const sent = await submitSponsorship(user.publicKey(), NETWORK, 'unused-xdr', deps([NATIVE, CIRCLE_LINE]));
    assert.deepEqual(sent, { status: 'ready' });
  });

  it('prepare builds a sponsor-signed envelope when the trustline is missing', async () => {
    const prepared = await prepareSponsorship(
      user.publicKey(),
      NETWORK,
      deps(null, {
        loadAccount: async () => ({ sequence: '42' }),
      }),
    );
    assert.equal(prepared.status, 'sign');
    if (prepared.status !== 'sign') return;
    assert.equal(prepared.need, 'create-and-trust');
    assert.equal(prepared.sponsor, sponsor.publicKey());
    const tx = new Transaction(prepared.xdr, prepared.networkPassphrase);
    assert.equal(tx.signatures.length, 1);
    assert.deepEqual(
      summarizeSponsorOps(tx.operations).map((o) => o.type),
      [
        'beginSponsoringFutureReserves',
        'createAccount',
        'changeTrust',
        'endSponsoringFutureReserves',
      ],
    );
  });
});
