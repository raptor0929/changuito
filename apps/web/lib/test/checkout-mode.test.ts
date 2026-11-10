import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readJob, startJob } from '../checkout/sandbox.ts';
import { checkoutMode } from '../shared-card.ts';

const ITEMS = [{ name: 'Leche', quantity: 1, sku: '1' }];
const OFF = { mock: false, mockFail: false };
const NO_SANDBOX = {} as unknown as NodeJS.ProcessEnv;
const WITH_SANDBOX = { SANDBOX_URL: 'https://sandbox.invalid' } as unknown as NodeJS.ProcessEnv;

/** A job id whose clock started `secs` ago, so the stateless mock is past its last phase. */
function aged(jobId: string, secs: number): string {
  const [m, flag, , n] = jobId.split('-');
  return `${m}-${flag}-${Date.now() - secs * 1000}-${n}`;
}

describe('which run a checkout gets', () => {
  it('a card member pays for real', () => {
    assert.equal(checkoutMode('ok'), 'live');
  });

  it('anyone else gets the demo, never a refusal', () => {
    assert.equal(checkoutMode('not-member'), 'demo');
    assert.equal(checkoutMode('no-card'), 'demo');
  });

  it("the operator's mock still wins for everyone", () => {
    assert.equal(checkoutMode('mock'), 'mock');
  });
});

describe('the demo run', () => {
  it('runs on the mock even with the mock off and no sandbox configured', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, NO_SANDBOX, { demo: true });
    assert.match(id, /^mock-h-\d+-1$/);
  });

  it('never reaches the real sandbox, even when one is configured', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, WITH_SANDBOX, { demo: true });
    assert.match(id, /^mock-h-/);
  });

  it('walks the same phases while it runs', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, NO_SANDBOX, { demo: true });
    const job = await readJob(aged(id, 16));
    assert.equal(job.status, 'running');
    assert.equal(job.phase, 'checkout');
  });

  it('stops at payment without paying, so the order refunds', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, NO_SANDBOX, { demo: true });
    const job = await readJob(aged(id, 30));
    assert.equal(job.status, 'done');
    assert.equal(job.phase, 'payment');
    assert.equal(job.result?.reached_payment, true);
    assert.equal(job.result?.payment, 'not_attempted');
    assert.equal(job.result?.store_order_id, null);
  });

  it('leaves the ordinary mock as it was: placed, or declined with the fail flag', async () => {
    const ok = await readJob(aged(await startJob('o', ITEMS, undefined, undefined, { mock: true, mockFail: false }, NO_SANDBOX), 30));
    assert.equal(ok.result?.payment, 'placed');
    const no = await readJob(aged(await startJob('o', ITEMS, undefined, undefined, { mock: true, mockFail: true }, NO_SANDBOX), 30));
    assert.equal(no.result?.payment, 'declined');
  });

  it('a real run still needs the Día login', async () => {
    await assert.rejects(startJob('o', ITEMS, undefined, undefined, OFF, WITH_SANDBOX), /Día login/);
  });
});
