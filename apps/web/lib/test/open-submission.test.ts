import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenConfirmationPending, recoverOpen, submitOpen } from '../checkout/open-submission.ts';

const submission = { orderId: 'ab'.repeat(32), tx: 'synthetic-signed-transaction' };
const status = { orderId: submission.orderId, openSig: 'confirmed-fixture-signature', checkoutKind: 'manual_fee_v1',
  stage: 'shopping', feeStatus: 'settled', manual: { preparation: 'ready', sessionActive: true } };

describe('checkout confirmation after a lost response', () => {
  it('recovers an already-funded prepared order when the PUT reply is lost', async () => {
    const calls: string[] = [];
    const result = await submitOpen(async (url, init) => {
      calls.push(url);
      if (init.method === 'PUT') throw new TypeError('Failed to fetch');
      return Response.json(status);
    }, submission, 'failed');
    assert.equal(result.openSig, status.openSig);
    assert.equal(result.status?.feeStatus, 'settled');
    assert.deepEqual(calls, ['/api/checkout/open', `/api/checkout/status?orderId=${submission.orderId}`]);
  });

  it('does not add recovery requests when confirmation arrives normally', async () => {
    let calls = 0;
    const result = await submitOpen(async (_, init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init.body)), submission);
      assert.ok(init.signal);
      return Response.json({ openSig: status.openSig });
    }, submission, 'failed');
    assert.equal(result.openSig, status.openSig);
    assert.equal(calls, 1);
  });

  it('keeps an unknown confirmation pending instead of claiming a failed payment', async () => {
    await assert.rejects(submitOpen(async (_, init) => {
      if (init.method === 'PUT') throw new TypeError('Failed to fetch');
      return Response.json({ ...status, openSig: null });
    }, submission, 'failed'), OpenConfirmationPending);
  });

  it('reuses the exact order and signed bytes on retry', async () => {
    const sent: unknown[] = [];
    const request = async (_: string, init: RequestInit) => {
      if (init.method === 'PUT') {
        sent.push(JSON.parse(String(init.body)));
        return sent.length === 1 ? new Response(null, { status: 502 }) : Response.json({ openSig: status.openSig });
      }
      return Response.json({ ...status, openSig: null });
    };
    await assert.rejects(submitOpen(request, submission, 'failed'), OpenConfirmationPending);
    await submitOpen(request, submission, 'failed');
    assert.deepEqual(sent, [submission, submission]);
  });

  it('never accepts a different order or an unsuccessful status response', async () => {
    assert.equal(await recoverOpen(async () => Response.json({ ...status, orderId: 'cd'.repeat(32) }), submission.orderId), null);
    assert.equal(await recoverOpen(async () => Response.json(status, { status: 401 }), submission.orderId), null);
  });

  it('reports a definitive rejected message after ruling out a funded order', async () => {
    await assert.rejects(submitOpen(async (_, init) => init.method === 'PUT'
      ? Response.json({ error: 'invalid signature' }, { status: 400 })
      : Response.json({ ...status, openSig: null }), submission, 'failed'), err =>
      err instanceof Error && !(err instanceof OpenConfirmationPending) && err.message === 'invalid signature');
  });
});
