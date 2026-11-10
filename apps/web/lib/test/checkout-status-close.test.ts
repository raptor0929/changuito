import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import { orderFromEscrowEvents, readOrderFromEvents } from '../checkout/escrow-events.ts';
import type { OrderAccount } from '../checkout/escrow-server.ts';
import type { CheckoutRecord } from '../checkout/store.ts';
import type { SandboxJob } from '../checkout/sandbox.ts';

/**
 * When the sandbox job finishes (or the escrow deadline passes), GET
 * /api/checkout/status must settle a confirmed store order and refund a
 * failed or expired one. The on-chain basket_hash is what settle sends —
 * a different cart stays rejected by the contract.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
env.CHG_SESSION_SECRET = 'session-test-secret';
delete env.DATABASE_URL;

const ORDER = 'a1'.repeat(32);
const BASKET = 'b2'.repeat(32);
const OTHER_BASKET = 'c3'.repeat(32);
const BUYER = Keypair.random().publicKey();
const SETTLE_TX = '11'.repeat(32);
const REFUND_TX = '22'.repeat(32);

const escrow = {
  order: null as OrderAccount | null,
  settles: [] as { order: OrderAccount; receipt: string }[],
  refunds: [] as OrderAccount[],
};

const jobs = new Map<string, SandboxJob>();

mock.module(new URL('../checkout/escrow-server.ts', import.meta.url).href, {
  namedExports: {
    async readOrder() {
      return escrow.order;
    },
    async settleOrder(order: OrderAccount, receiptHash: Uint8Array) {
      escrow.settles.push({ order, receipt: Buffer.from(receiptHash).toString('hex') });
      return SETTLE_TX;
    },
    async refundOrder(order: OrderAccount) {
      escrow.refunds.push(order);
      return REFUND_TX;
    },
  },
});

mock.module(new URL('../checkout/sandbox.ts', import.meta.url).href, {
  namedExports: {
    async readJob(id: string) {
      const job = jobs.get(id);
      if (!job) throw new Error(`missing job ${id}`);
      return job;
    },
  },
});

function openOrder(over: Partial<OrderAccount> = {}): OrderAccount {
  const now = Math.floor(Date.now() / 1000);
  return {
    orderId: ORDER,
    buyer: BUYER,
    amount: 12_500_000n,
    basketHash: BASKET,
    status: 'open',
    openedAt: now - 60,
    deadline: now + 3_000,
    receiptHash: '00'.repeat(32),
    ...over,
  };
}

function record(over: Partial<CheckoutRecord> = {}): CheckoutRecord {
  return {
    orderId: ORDER,
    buyer: BUYER,
    amount: '12500000',
    amountCents: 1250,
    basketHash: BASKET,
    arsPerUsd: 1000,
    totalDisplay: '$12.50',
    retailer: 'dia',
    lines: [],
    handoffUrl: 'https://dia.test/cart',
    createdAt: Date.now(),
    jobId: 'job-1',
    openSig: 'ab'.repeat(32),
    startedAt: Date.now(),
    ...over,
  };
}

describe('escrow events rebuild an open order', () => {
  it('reads amount, basket and deadline from an opened event', () => {
    const deadline = 1_762_800_000;
    const topic = [
      xdr.ScVal.scvSymbol('opened').toXDR('base64'),
      nativeToScVal(Buffer.from(ORDER, 'hex'), { type: 'bytes' }).toXDR('base64'),
      new Address(BUYER).toScVal().toXDR('base64'),
    ];
    const value = nativeToScVal(
      {
        amount: 114_400_000n,
        basket_hash: Buffer.from(BASKET, 'hex'),
        deadline: BigInt(deadline),
      },
      {
        type: {
          amount: ['symbol', 'i128'],
          basket_hash: ['symbol', 'bytes'],
          deadline: ['symbol', 'u64'],
        },
      },
    ).toXDR('base64');

    const order = orderFromEscrowEvents(ORDER, [{ topic, value }]);
    assert.deepEqual(order, {
      orderId: ORDER,
      buyer: BUYER,
      amount: 114_400_000n,
      basketHash: BASKET,
      status: 'open',
      openedAt: deadline - 3600,
      deadline,
      receiptHash: '00'.repeat(32),
    });
  });

  it('marks settled after a later settled event for the same order', () => {
    const opened = {
      topic: [
        xdr.ScVal.scvSymbol('opened').toXDR('base64'),
        nativeToScVal(Buffer.from(ORDER, 'hex'), { type: 'bytes' }).toXDR('base64'),
        new Address(BUYER).toScVal().toXDR('base64'),
      ],
      value: nativeToScVal(
        {
          amount: 1_000_000n,
          basket_hash: Buffer.from(BASKET, 'hex'),
          deadline: 1_762_800_000n,
        },
        {
          type: {
            amount: ['symbol', 'i128'],
            basket_hash: ['symbol', 'bytes'],
            deadline: ['symbol', 'u64'],
          },
        },
      ).toXDR('base64'),
    };
    const receipt = 'dd'.repeat(32);
    const settled = {
      topic: [
        xdr.ScVal.scvSymbol('settled').toXDR('base64'),
        nativeToScVal(Buffer.from(ORDER, 'hex'), { type: 'bytes' }).toXDR('base64'),
        new Address(BUYER).toScVal().toXDR('base64'),
      ],
      value: nativeToScVal(
        {
          amount: 1_000_000n,
          receipt_hash: Buffer.from(receipt, 'hex'),
        },
        {
          type: {
            amount: ['symbol', 'i128'],
            receipt_hash: ['symbol', 'bytes'],
          },
        },
      ).toXDR('base64'),
    };
    const order = orderFromEscrowEvents(ORDER, [opened, settled]);
    assert.equal(order?.status, 'settled');
    assert.equal(order?.basketHash, BASKET);
    assert.equal(order?.receiptHash, receipt);
  });

  it('queries getEvents with a three-topic filter matching order id', async () => {
    const deadline = 1_762_800_000;
    const orderTopic = nativeToScVal(Buffer.from(ORDER, 'hex'), { type: 'bytes' }).toXDR('base64');
    const topic = [
      xdr.ScVal.scvSymbol('opened').toXDR('base64'),
      orderTopic,
      new Address(BUYER).toScVal().toXDR('base64'),
    ];
    const value = nativeToScVal(
      {
        amount: 114_400_000n,
        basket_hash: Buffer.from(BASKET, 'hex'),
        deadline: BigInt(deadline),
      },
      {
        type: {
          amount: ['symbol', 'i128'],
          basket_hash: ['symbol', 'bytes'],
          deadline: ['symbol', 'u64'],
        },
      },
    ).toXDR('base64');

    const realFetch = globalThis.fetch;
    const captured: { topics: string[] | undefined } = { topics: undefined };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
        params?: { filters?: { topics?: string[][] }[] };
      };
      if (body.method === 'getLatestLedger') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sequence: 5_000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (body.method === 'getEvents') {
        captured.topics = body.params?.filters?.[0]?.topics?.[0];
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { events: [{ topic, value }] },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const order = await readOrderFromEvents(ORDER);
      assert.ok(Array.isArray(captured.topics));
      assert.equal(captured.topics.length, 3);
      assert.equal(captured.topics[0], '*');
      assert.equal(captured.topics[1], orderTopic);
      assert.equal(captured.topics[2], '*');
      assert.deepEqual(order, {
        orderId: ORDER,
        buyer: BUYER,
        amount: 114_400_000n,
        basketHash: BASKET,
        status: 'open',
        openedAt: deadline - 3600,
        deadline,
        receiptHash: '00'.repeat(32),
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('GET /api/checkout/status closes the escrow', () => {
  let GET: (req: Request) => Promise<Response>;
  let cookie: string;
  let store: { get: (id: string) => Promise<CheckoutRecord | undefined>; set: (rec: CheckoutRecord) => Promise<void> };

  before(async () => {
    const { mintUserToken, USER_COOKIE } = await import('../login-gate.ts');
    cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(BUYER, 'session-test-secret'))}`;
    store = (await import('../checkout/store.ts')).checkoutStore();
    GET = (await import('../../app/api/checkout/status/route.ts')).GET;
  });

  beforeEach(async () => {
    escrow.order = null;
    escrow.settles = [];
    escrow.refunds = [];
    jobs.clear();
    await store.set(record());
  });

  after(() => {
    mock.reset();
  });

  const poll = () =>
    GET(new Request(`https://app.changuito.me/api/checkout/status?orderId=${ORDER}`, {
      headers: { cookie },
    }));

  it('settles when the store confirmed the order, using the on-chain basket', async () => {
    escrow.order = openOrder();
    jobs.set('job-1', {
      job_id: 'job-1',
      status: 'done',
      phase: 'placed',
      result: {
        reached_payment: true,
        payment: 'placed',
        store_order_id: 'DIA-9',
        items_added: 1,
        cart: { orderFormId: 'of-1' },
      },
    });

    const res = await poll();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stage, 'done');
    assert.equal(body.closeSig, SETTLE_TX);
    assert.equal(escrow.settles.length, 1);
    assert.equal(escrow.refunds.length, 0);
    assert.equal(escrow.settles[0]?.order.basketHash, BASKET);
    assert.notEqual(escrow.settles[0]?.order.basketHash, OTHER_BASKET);
  });

  it('refunds when the store failed to place the order', async () => {
    escrow.order = openOrder();
    jobs.set('job-1', {
      job_id: 'job-1',
      status: 'failed',
      phase: 'payment',
      result: {
        reached_payment: true,
        payment: 'declined',
        items_added: 1,
      },
    });

    const res = await poll();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stage, 'refunded');
    assert.equal(body.closeSig, REFUND_TX);
    assert.equal(escrow.refunds.length, 1);
    assert.equal(escrow.settles.length, 0);
  });

  it('refunds an open order once its deadline has passed', async () => {
    const now = Math.floor(Date.now() / 1000);
    escrow.order = openOrder({ deadline: now - 5 });
    jobs.set('job-1', {
      job_id: 'job-1',
      status: 'running',
      phase: 'shop',
    });

    const res = await poll();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stage, 'refunded');
    assert.equal(body.closeSig, REFUND_TX);
    assert.equal(escrow.refunds.length, 1);
    assert.equal(escrow.settles.length, 0);
    assert.match(String(body.error), /venció/);
  });

  it('does not settle with a basket other than the locked one', async () => {
    // The status route settles with order.basketHash from readOrder (chain).
    // A wrong cart never replaces that field here; the contract still rejects
    // BasketMismatch if a caller tried.
    escrow.order = openOrder({ basketHash: BASKET });
    jobs.set('job-1', {
      job_id: 'job-1',
      status: 'done',
      phase: 'placed',
      result: {
        reached_payment: true,
        payment: 'placed',
        items_added: 1,
      },
    });
    await store.set(record({ basketHash: OTHER_BASKET }));

    const res = await poll();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stage, 'done');
    assert.equal(escrow.settles[0]?.order.basketHash, BASKET);
  });
});
