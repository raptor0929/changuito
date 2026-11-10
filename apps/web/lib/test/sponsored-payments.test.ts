import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHANGITO_SPONSOR,
  ensureSponsored,
  passesSponsoredPaymentCheck,
  recordEscrowPayment,
  type SponsoredPaymentRecord,
  type SponsoredPaymentRecorder,
} from '../sponsored-payments.ts';

/** In-memory stand-in for the report store. No Horizon, no Expert links. */
function fakeRecorder(): SponsoredPaymentRecorder & {
  rows: Map<string, SponsoredPaymentRecord>;
} {
  const rows = new Map<string, SponsoredPaymentRecord>();
  return {
    rows,
    get: (address) => rows.get(address),
    put: (record) => void rows.set(record.address, record),
  };
}

const ACCOUNTS = ['account-sponsored-1', 'account-sponsored-2', 'account-sponsored-3'] as const;

describe('sponsored payment acceptance', () => {
  it('three accounts pass: Changuito sponsor, USDC trustline, 0 own XLM, escrow payment', () => {
    const recorder = fakeRecorder();
    const now = 1_760_000_000_000;

    for (const [i, address] of ACCOUNTS.entries()) {
      const { sponsored } = ensureSponsored(recorder, address, now + i);
      assert.equal(sponsored, true);
      recordEscrowPayment(recorder, address, `escrow-payment-${i + 1}`);
    }

    assert.equal(recorder.rows.size, 3);
    for (const address of ACCOUNTS) {
      const record = recorder.get(address);
      assert.ok(record);
      assert.equal(record.sponsor, CHANGITO_SPONSOR);
      assert.equal(record.usdcTrustline, true);
      assert.equal(record.ownXlm, '0');
      assert.ok(record.escrowPayment);
      assert.equal(passesSponsoredPaymentCheck(record), true);
    }
  });

  it('a second run does not sponsor again', () => {
    const recorder = fakeRecorder();
    const address = ACCOUNTS[0];

    const first = ensureSponsored(recorder, address, 1_760_000_000_000);
    assert.equal(first.sponsored, true);
    assert.equal(first.record.sponsoredAt, 1_760_000_000_000);

    const second = ensureSponsored(recorder, address, 1_760_000_000_999);
    assert.equal(second.sponsored, false);
    assert.equal(second.record.sponsoredAt, 1_760_000_000_000);
    assert.equal(recorder.rows.size, 1);
  });

  it('fails the check until an escrow payment is recorded', () => {
    const recorder = fakeRecorder();
    const { record } = ensureSponsored(recorder, ACCOUNTS[1], 1);
    assert.equal(passesSponsoredPaymentCheck(record), false);

    const paid = recordEscrowPayment(recorder, ACCOUNTS[1], 'escrow-payment-ready');
    assert.equal(passesSponsoredPaymentCheck(paid), true);
  });

  it('rejects a record that is not Changuito-sponsored or that holds its own XLM', () => {
    assert.equal(
      passesSponsoredPaymentCheck({
        address: ACCOUNTS[2],
        sponsor: 'someone-else',
        usdcTrustline: true,
        ownXlm: '0',
        escrowPayment: 'escrow-payment-x',
        sponsoredAt: 1,
      }),
      false,
    );
    assert.equal(
      passesSponsoredPaymentCheck({
        address: ACCOUNTS[2],
        sponsor: CHANGITO_SPONSOR,
        usdcTrustline: true,
        ownXlm: '1',
        escrowPayment: 'escrow-payment-x',
        sponsoredAt: 1,
      }),
      false,
    );
  });
});
