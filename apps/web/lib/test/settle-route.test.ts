import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { chain, mockBindings, mockResolver, RESOLVER_PUBLIC, Status } from './support/fake-soroban.ts';
import { signedProof } from './support/proof.ts';

/**
 * POST /api/settle as a handler, past its gate (lib/test/settle-gate.test.ts
 * covers the gate alone) and down to the escrow, with the contract client
 * scripted. What it must get right: only the order's buyer closes it, a
 * closed order is never closed again, a settle carries the locked basket and a
 * receipt anyone can re-derive, a refund goes through the resolver, and a
 * failure answers in plain words while the detail stays in the log.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
delete env.DATABASE_URL;

mockBindings();
mockResolver();

const ORDER = 'a'.repeat(64);
const BASKET = 'c'.repeat(64);

describe('POST /api/settle', () => {
  let POST: (req: Request) => Promise<Response>;
  let human: string;
  const buyer = Keypair.random();
  const stranger = Keypair.random();
  const realError = console.error;
  let logs: string[] = [];

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    POST = (await import('../../app/api/settle/route.ts')).POST;
  });
  beforeEach(() => {
    chain.reset();
    chain.resolver = RESOLVER_PUBLIC;
    chain.orders.set(ORDER, { buyer: buyer.publicKey(), amount: 12_500_000n, basket_hash: Buffer.from(BASKET, 'hex'), status: Status.Open });
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  });
  after(() => void (console.error = realError));

  const call = (action: 'settle' | 'refund', kp = buyer, extra: Record<string, unknown> = {}) =>
    POST(
      new Request('https://app.changuito.me/api/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: human },
        body: JSON.stringify({
          action,
          orderId: ORDER,
          basketHash: BASKET,
          address: kp.publicKey(),
          proof: signedProof(kp, action, ORDER),
          ...extra,
        }),
      }),
    );

  it('settles the buyer’s open order, signed by the resolver, with a re-derivable receipt', async () => {
    const res = await call('settle');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.action, 'settle');
    assert.equal(body.amountDisplay.replace(/0+$/, ''), '1.25');
    assert.match(body.receipt, new RegExp(buyer.publicKey()));
    assert.match(body.receiptHash, /^[0-9a-f]{64}$/);
    const sent = chain.calls.find((c) => c.method === 'settle');
    assert.equal(sent?.signedBy, RESOLVER_PUBLIC);
    assert.equal((sent?.args as { receipt: string }).receipt, body.receiptHash);
  });

  it('refunds through the resolver as caller', async () => {
    const res = await call('refund');
    assert.equal(res.status, 200);
    const sent = chain.calls.find((c) => c.method === 'refund');
    assert.deepEqual(sent?.args, { order: ORDER, caller: RESOLVER_PUBLIC });
  });

  it('a stranger with a valid proof of their own cannot close it, and learns nothing', async () => {
    const res = await call('refund', stranger);
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.match(text, /not_your_order/);
    assert.doesNotMatch(text, /12500000|1\.25|Open|abierta/);
    assert.ok(!chain.calls.some((c) => c.method === 'refund' || c.method === 'settle'));
  });

  it('never closes an order twice', async () => {
    chain.orders.get(ORDER)!.status = Status.Settled;
    const res = await call('refund');
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /liquidada/);
    assert.ok(!chain.calls.some((c) => c.method === 'refund'));
  });

  it('refuses a settle for a basket other than the one locked', async () => {
    const res = await call('settle', buyer, { basketHash: 'd'.repeat(64) });
    assert.equal(res.status, 409);
    assert.ok(!chain.calls.some((c) => c.method === 'settle'));
  });

  it('404s an order the contract does not have', async () => {
    chain.orders.clear();
    assert.equal((await call('refund')).status, 404);
  });

  it('a chain failure answers in plain words; the detail stays in the log', async () => {
    chain.fail = new Error('simulation failed: HostError XDR AAAA https://soroban-testnet.stellar.org');
    const res = await call('settle');
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.match(text, /No pudimos cerrar la orden/);
    assert.doesNotMatch(text, /XDR|soroban|HostError/);
    assert.match(logs.join('\n'), /\[settle\] failed/);
  });
});
