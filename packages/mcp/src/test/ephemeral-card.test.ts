import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { EphemeralCard } from '../pay/ephemeral-card.js';
import { forgetAllSecrets, redactToString } from '../secure/redact.js';
import { VyrionClient } from '../pay/vyrion.js';

const KEY = 'sk_test_abcdef0123456789';
const PAN = '4242424242424242';

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function stub(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = queue.shift() ?? { status: 500, body: { message: 'stub exhausted' } };
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(next.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const CARD = { id: 'card_1', bin_id: 'bin_1', network: 'visa', last4: '4242', status: 'active', balance: 23.5 };
const DETAILS = { id: 'card_1', pan: PAN, cvv: '737', expiry_month: '09', expiry_year: '2029' };

function make(responses: Array<{ status?: number; body?: unknown }>) {
  const s = stub([{ body: CARD }, ...responses]);
  const client = new VyrionClient({ apiKey: KEY, fetchImpl: s.fetchImpl });
  return { client, ...s };
}

const create = (client: VyrionClient, over = {}) =>
  EphemeralCard.create({
    client,
    binId: 'bin_1',
    amountCents: 2_350,
    allowedCategories: ['5411'],
    ...over,
  });

/** Clock and sleep the polling loop can be driven by, instead of real time. */
function fakeClock(stepMs = 3_000) {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms || stepMs) };
}

afterEach(() => forgetAllSecrets());

describe('creating the card', () => {
  it('sets the spending limit to exactly what it funded — the buffer is float, not spend', async () => {
    const { client, calls } = make([]);
    const card = await create(client);
    assert.equal(calls[0]?.method, 'POST');
    assert.match(calls[0]!.url, /\/cards$/);
    assert.deepEqual(calls[0]!.body, {
      bin_id: 'bin_1',
      amount: 23.5,
      label: 'grocery order',
      spending_limit: 23.5,
      allowed_categories: ['5411'],
    });
    assert.equal(card.fundedCents, 2_350);
    assert.equal(card.last4, '4242');
  });

  it('passes a caller label and metadata through', async () => {
    const { client, calls } = make([]);
    await create(client, { label: 'Día 2026-09-19', metadata: { orderFormId: 'ABC' } });
    assert.equal((calls[0]!.body as { label: string }).label, 'Día 2026-09-19');
    assert.deepEqual((calls[0]!.body as { metadata: unknown }).metadata, { orderFormId: 'ABC' });
  });
});

describe('card details', () => {
  it('fetches once and caches — the details endpoint is rate limited', async () => {
    const { client, calls } = make([{ body: DETAILS }]);
    const card = await create(client);
    const a = await card.cardDetails();
    const b = await card.cardDetails();
    assert.equal(a.pan, PAN);
    assert.equal(a, b);
    assert.equal(calls.filter((c) => c.url.endsWith('/details')).length, 1);
  });

  it('registers the PAN with the redactor, so it cannot reach a log line', async () => {
    const { client } = make([{ body: DETAILS }]);
    const card = await create(client);
    await card.cardDetails();
    assert.equal(redactToString(`paying with ${PAN}`).includes(PAN), false);
  });

  it('refuses to hand out details for a terminated card', async () => {
    const { client } = make([{ body: { id: 'card_1', status: 'terminated' } }]);
    const card = await create(client);
    await card.terminate();
    await assert.rejects(() => card.cardDetails(), /already been terminated/);
  });
});

describe('the 3DS race', () => {
  const challenge = (over = {}) => ({
    id: 'ch_1',
    card_id: 'card_1',
    merchant: 'DIA',
    amount: 23.5,
    otp: '445566',
    status: 'pending',
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    ...over,
  });

  it('returns the code as soon as it appears', async () => {
    const { client } = make([{ body: [] }, { body: [challenge()] }]);
    const card = await create(client);
    assert.equal(await card.otp(fakeClock()), '445566');
  });

  it('never hands back the same challenge twice', async () => {
    const { client } = make([{ body: [challenge()] }, { body: [challenge()] }, { body: [] }, { body: [] }]);
    const card = await create(client);
    assert.equal(await card.otp(fakeClock()), '445566');
    assert.equal(
      await card.otp({ ...fakeClock(), timeoutMs: 9_000 }),
      undefined,
      'a code already typed is not a code that arrived',
    );
  });

  it('ignores expired and already-used challenges', async () => {
    const { client } = make([
      {
        body: [
          challenge({ id: 'old', otp: '111111', expires_at: new Date(Date.now() - 1_000).toISOString() }),
          challenge({ id: 'used', otp: '222222', status: 'used' }),
        ],
      },
      { body: [challenge({ id: 'fresh', otp: '333333' })] },
    ]);
    const card = await create(client);
    assert.equal(await card.otp(fakeClock()), '333333');
  });

  it('gives up cleanly instead of hanging when no code ever arrives', async () => {
    const { client, calls } = make(Array(50).fill({ body: [] }));
    const card = await create(client);
    const clock = fakeClock();
    assert.equal(await card.otp({ ...clock, timeoutMs: 30_000, pollMs: 3_000 }), undefined);
    const polls = calls.filter((c) => c.url.includes('/3ds')).length;
    assert.ok(polls >= 9 && polls <= 11, `polled ${polls} times in a 30s window`);
  });

  it('survives an outage mid-poll rather than aborting the payment', async () => {
    const { client } = make([{ status: 503, body: { message: 'upstream' } }, { body: [challenge()] }]);
    const card = await create(client);
    assert.equal(await card.otp(fakeClock()), '445566');
  });

  it('registers the OTP with the redactor', async () => {
    const { client } = make([{ body: [challenge()] }]);
    const card = await create(client);
    const otp = await card.otp(fakeClock());
    assert.equal(redactToString(`code ${otp}`).includes('445566'), false);
  });
});

describe('teardown', () => {
  it('terminates once, and is safe to call again from a finally', async () => {
    const { client, calls } = make([{ body: { id: 'card_1', status: 'terminated' } }]);
    const card = await create(client);
    await card.terminate();
    await card.terminate();
    const deletes = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 1);
    assert.match(deletes[0]!.url, /\/cards\/card_1$/);
  });

  it('does not throw when termination fails — it says so loudly instead', async () => {
    const { client } = make([{ status: 500, body: { message: 'gateway down' } }]);
    const card = await create(client);
    await card.terminate();
  });

  it('forgets the card details, but the PAN is still caught by shape', async () => {
    const { client } = make([{ body: DETAILS }, { body: { id: 'card_1', status: 'terminated' } }]);
    const card = await create(client);
    await card.cardDetails();
    await card.terminate();
    assert.equal(redactToString(`leftover ${PAN}`).includes(PAN), false, 'the Luhn heuristic still covers it');
  });

  it('freezing a card that cannot be frozen does not throw either', async () => {
    const { client } = make([{ status: 500, body: { message: 'nope' } }]);
    const card = await create(client);
    await card.freeze();
  });
});
