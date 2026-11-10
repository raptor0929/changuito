import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TIMEOUT_SECS } from '../order.ts';
import { prepareOpen, type ChannelsDeps, type OpenFields } from '../server/channels.ts';

const ESCROW = 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S';
const BUYER = 'GCX2V5B45V34KPXT3ZLRRKU2WVGN6UIJPX6ZAUITINFFGM5Y7S2VXRUV';
const ORDER = 'a8'.repeat(32);
const BASKET = 'b7'.repeat(32);
const LANDED = '89'.repeat(32);

function input(): OpenFields {
  return {
    orderId: ORDER,
    amount: '114400000',
    basketHash: BASKET,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    contractId: ESCROW,
    method: 'open',
    network: 'testnet',
  };
}

function deps(over: Partial<ChannelsDeps> = {}): ChannelsDeps {
  return {
    apiKey: 'test-key',
    client: null,
    simulator: {
      async simulate() {
        throw new Error('should not simulate an open that already landed');
      },
    },
    loadRecord: async () => null,
    readOpened: async () => false,
    ...over,
  };
}

describe('an opened event is the payment', () => {
  it('returns that transaction instead of asking for another signature', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const prepared = await prepareOpen(input(), BUYER, deps({
      findOpenHash: async () => LANDED,
    }));
    assert.deepEqual(prepared, { kind: 'opened', hash: LANDED });
  });

  it('returns the event hash when a previous attempt was still unmarked', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const prepared = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({
        orderId: ORDER,
        buyer: BUYER,
        amount: '114400000',
        basketHash: BASKET,
        openAttemptSig: 'ab'.repeat(32),
      }),
      recoverAttempt: async (rec) => rec,
      findOpenHash: async () => LANDED,
    }));
    assert.deepEqual(prepared, { kind: 'opened', hash: LANDED });
  });
});
