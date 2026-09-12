import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { forgetAllSecrets, redactToString } from '../secure/redact.js';
import { VyrionError } from '../pay/types.js';
import {
  CARD_MAX_CENTS,
  CARD_MIN_CENTS,
  VyrionClient,
  forgetCardDetails,
  formatUsd,
  toCents,
  toUsd,
} from '../pay/vyrion.js';

const KEY = 'sk_test_abcdef0123456789';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** A fetch stub that records what was sent and replays a queue of responses. */
function stub(responses: Array<{ status?: number; body?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = queue.shift() ?? { status: 500, body: { message: 'stub exhausted' } };
    const status = next.status ?? 200;
    const text = next.text ?? JSON.stringify(next.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function client(responses: Parameters<typeof stub>[0], key = KEY) {
  const s = stub(responses);
  return { c: new VyrionClient({ apiKey: key, fetchImpl: s.fetchImpl }), ...s };
}

afterEach(() => forgetAllSecrets());

describe('construction', () => {
  it('refuses an empty key with a pointer to the setup docs', () => {
    assert.throws(() => new VyrionClient({ apiKey: '' }), /SETUP\.md/);
  });

  it('refuses a live key unless live spending is explicitly allowed', () => {
    assert.throws(
      () => new VyrionClient({ apiKey: 'sk_live_deadbeefdeadbeef' }),
      /ALLOW_LIVE=1/,
    );
  });

  it('accepts a live key when allowLive is set, and says so', () => {
    const c = new VyrionClient({ apiKey: 'sk_live_deadbeefdeadbeef', allowLive: true });
    assert.equal(c.isLive, true);
  });

  it('marks a sandbox key as not live', () => {
    assert.equal(new VyrionClient({ apiKey: KEY }).isLive, false);
  });

  it('registers the API key with the redactor so it cannot be logged', () => {
    new VyrionClient({ apiKey: KEY });
    assert.ok(!redactToString(`key=${KEY}`).includes(KEY));
  });

  it('strips a trailing slash from a custom base url', async () => {
    const s = stub([{ body: { balance: 0, pending_deposits: 0 } }]);
    const c = new VyrionClient({ apiKey: KEY, baseUrl: 'https://x.test/api/v1/', fetchImpl: s.fetchImpl });
    await c.walletBalance();
    assert.equal(s.calls[0].url, 'https://x.test/api/v1/wallet/balance');
  });
});

describe('request shape', () => {
  it('sends a bearer token and asks for JSON', async () => {
    const { c, calls } = client([{ body: { balance: 1 } }]);
    await c.walletBalance();
    assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].headers.Accept, 'application/json');
  });

  it('omits Content-Type on bodyless requests', async () => {
    const { c, calls } = client([{ body: { balance: 1 } }]);
    await c.walletBalance();
    assert.equal(calls[0].headers['Content-Type'], undefined);
    assert.equal(calls[0].body, undefined);
  });

  it('hits the documented base url by default', async () => {
    const { c, calls } = client([{ body: { balance: 1 } }]);
    await c.walletBalance();
    assert.ok(calls[0].url.startsWith('https://vyrioncard.com/api/v1/'), calls[0].url);
  });
});

describe('errors', () => {
  it('surfaces the nested error message and code on a 400', async () => {
    const { c } = client([
      { status: 400, body: { error: { code: 'insufficient_funds', message: 'Wallet balance too low' } } },
    ]);
    await assert.rejects(c.walletBalance(), (e: unknown) => {
      assert.ok(e instanceof VyrionError);
      assert.equal(e.status, 400);
      assert.equal(e.code, 'insufficient_funds');
      assert.match(e.message, /Wallet balance too low/);
      return true;
    });
  });

  it('surfaces a flat message on a 401', async () => {
    const { c } = client([{ status: 401, body: { message: 'Invalid API key' } }]);
    await assert.rejects(c.walletBalance(), (e: unknown) => {
      assert.equal((e as VyrionError).status, 401);
      assert.match((e as Error).message, /Invalid API key/);
      return true;
    });
  });

  it('falls back to the status code when the body explains nothing', async () => {
    const { c } = client([{ status: 429, body: {} }]);
    await assert.rejects(c.walletBalance(), /HTTP 429/);
  });

  it('reports a non-JSON body rather than throwing a parse error', async () => {
    const { c } = client([{ status: 502, text: '<html>bad gateway</html>' }]);
    await assert.rejects(c.walletBalance(), (e: unknown) => {
      assert.ok(e instanceof VyrionError);
      assert.match((e as Error).message, /non-JSON body \(HTTP 502\)/);
      return true;
    });
  });

  it('treats an empty 200 body as an empty object', async () => {
    const { c } = client([{ status: 200, text: '' }]);
    const b = await c.walletBalance();
    assert.equal(b.settled, 0);
  });
});

describe('wallet', () => {
  it('converts USD floats to integer cents', async () => {
    const { c } = client([{ body: { balance: 142.5, pending_deposits: 20.01, currency: 'USD' } }]);
    const b = await c.walletBalance();
    assert.equal(b.settled, 14_250);
    assert.equal(b.pending, 2001);
    assert.equal(b.raw.currency, 'USD');
  });

  it('keeps settled and pending strictly separate', async () => {
    const { c } = client([{ body: { balance: 0, pending_deposits: 500 } }]);
    const b = await c.walletBalance();
    assert.equal(b.settled, 0, 'pending must never be folded into settled');
    assert.equal(b.pending, 50_000);
  });

  it('defaults both to zero when the fields are absent', async () => {
    const { c } = client([{ body: {} }]);
    const b = await c.walletBalance();
    assert.deepEqual([b.settled, b.pending], [0, 0]);
  });

  it('passes the currency as a query parameter for a deposit address', async () => {
    const { c, calls } = client([{ body: { currency: 'usdt', address: '0xabc', network: 'erc20' } }]);
    const a = await c.depositAddress('usdt');
    assert.match(calls[0].url, /currency=usdt/);
    assert.equal(a.address, '0xabc');
  });

  it('picks the matching currency out of a collection response', async () => {
    const { c } = client([
      { body: { addresses: [
        { currency: 'btc', address: 'bc1qbtc' },
        { currency: 'usdt', address: '0xusdt' },
      ] } },
    ]);
    assert.equal((await c.depositAddress('usdt')).address, '0xusdt');
  });

  it('accepts a bare array response', async () => {
    const { c } = client([{ body: [{ currency: 'eth', address: '0xeth' }] }]);
    assert.equal((await c.depositAddress('eth')).address, '0xeth');
  });

  it('throws rather than returning an address-less object', async () => {
    const { c } = client([{ body: { addresses: [] } }]);
    await assert.rejects(c.depositAddress('btc'), /No btc deposit address/);
  });
});

describe('bins', () => {
  const BINS = [
    { id: 'b-low', network: 'visa', type: 'prepaid', '3ds': true, acceptance_rate: 0.71 },
    { id: 'b-no3ds', network: 'visa', type: 'prepaid', '3ds': false, acceptance_rate: 0.99 },
    { id: 'b-high', network: 'mastercard', type: 'prepaid', '3ds': true, acceptance_rate: 0.94 },
  ];

  it('drops BINs without 3DS however good their acceptance rate looks', async () => {
    const { c } = client([{ body: BINS }]);
    const list = await c.bins();
    assert.ok(!list.some((b) => b.id === 'b-no3ds'));
  });

  it('ranks the survivors best-first', async () => {
    const { c } = client([{ body: BINS }]);
    assert.deepEqual((await c.bins()).map((b) => b.id), ['b-high', 'b-low']);
  });

  it('ranks correctly when the account reports percentages instead of fractions', async () => {
    const { c } = client([{ body: [
      { id: 'pct-low', '3ds': true, acceptance_rate: 71 },
      { id: 'pct-high', '3ds': true, acceptance_rate: 94 },
    ] }]);
    assert.deepEqual((await c.bins()).map((b) => b.id), ['pct-high', 'pct-low']);
  });

  it('keeps a BIN whose acceptance rate is missing, ranked last', async () => {
    const { c } = client([{ body: [
      { id: 'unknown', '3ds': true },
      { id: 'known', '3ds': true, acceptance_rate: 0.5 },
    ] }]);
    assert.deepEqual((await c.bins()).map((b) => b.id), ['known', 'unknown']);
  });

  it('accepts the wrapped {bins:[...]} shape', async () => {
    const { c } = client([{ body: { bins: BINS } }]);
    assert.equal((await c.bins()).length, 2);
  });
});

describe('cards', () => {
  const CARD = { id: 'card_1', bin_id: 'b1', network: 'visa', last4: '4242', status: 'active', balance: 20 };

  it('sends dollars on the wire while taking cents from us', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await c.createCard({ binId: 'b1', amountCents: 1462, spendingLimitCents: 1462 });
    assert.deepEqual(calls[0].body, { bin_id: 'b1', amount: 14.62, spending_limit: 14.62 });
  });

  it('includes the MCC whitelist and metadata when given', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await c.createCard({
      binId: 'b1',
      amountCents: 2000,
      label: 'dia-order',
      allowedCategories: ['5411'],
      metadata: { order: 'x' },
    });
    const b = calls[0].body as Record<string, unknown>;
    assert.deepEqual(b.allowed_categories, ['5411']);
    assert.deepEqual(b.metadata, { order: 'x' });
    assert.equal(b.label, 'dia-order');
  });

  it('omits optional fields entirely rather than sending nulls', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await c.createCard({ binId: 'b1', amountCents: 2000 });
    assert.deepEqual(Object.keys(calls[0].body as object).sort(), ['amount', 'bin_id']);
  });

  it('truncates an over-long label instead of letting the API reject it', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await c.createCard({ binId: 'b1', amountCents: 2000, label: 'x'.repeat(200) });
    assert.equal(String((calls[0].body as { label: string }).label).length, 64);
  });

  it('refuses to create a card below the $1 minimum, without a round trip', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await assert.rejects(c.createCard({ binId: 'b1', amountCents: 99 }), /minimum card funding/);
    assert.equal(calls.length, 0, 'must fail before the network call');
  });

  it('refuses to create a card above the $5,000 maximum', async () => {
    const { c } = client([{ body: CARD }]);
    await assert.rejects(
      c.createCard({ binId: 'b1', amountCents: CARD_MAX_CENTS + 1 }),
      /maximum card funding/,
    );
  });

  it('accepts exactly the minimum and exactly the maximum', async () => {
    const { c } = client([{ body: CARD }, { body: CARD }]);
    await c.createCard({ binId: 'b1', amountCents: CARD_MIN_CENTS });
    await c.createCard({ binId: 'b1', amountCents: CARD_MAX_CENTS });
  });

  it('refuses a fractional cent amount', async () => {
    const { c } = client([{ body: CARD }]);
    await assert.rejects(c.createCard({ binId: 'b1', amountCents: 1462.5 }), /integer number of cents/);
  });

  it('applies the same bounds to a top-up', async () => {
    const { c } = client([{ body: CARD }]);
    await assert.rejects(c.fundCard('card_1', 50), /minimum card funding/);
  });

  it('posts a top-up to the fund endpoint', async () => {
    const { c, calls } = client([{ body: CARD }]);
    await c.fundCard('card_1', 500);
    assert.match(calls[0].url, /\/cards\/card_1\/fund$/);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { amount: 5 });
  });

  it('freezes with a POST and terminates with a DELETE', async () => {
    const { c, calls } = client([{ body: CARD }, { body: { id: 'card_1', status: 'terminated' } }]);
    await c.freezeCard('card_1');
    await c.terminateCard('card_1');
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/freeze$/);
    assert.equal(calls[1].method, 'DELETE');
    assert.match(calls[1].url, /\/cards\/card_1$/);
  });
});

describe('card details are treated as radioactive', () => {
  const DETAILS = {
    id: 'card_1',
    pan: '4111 1111 1111 1111',
    cvv: '737',
    expiry_month: '11',
    expiry_year: '2029',
  };

  it('registers the PAN with the redactor the instant it arrives', async () => {
    const { c } = client([{ body: DETAILS }]);
    const d = await c.cardDetails('card_1');
    assert.ok(!redactToString(`paying with ${d.pan}`).includes('4111'));
  });

  it('registers the digits-only form too, since that is what gets typed', async () => {
    const { c } = client([{ body: DETAILS }]);
    await c.cardDetails('card_1');
    assert.ok(!redactToString('pan=4111111111111111').includes('4111111111111111'));
  });

  it('drops the PAN out of the registry when the payment step ends', async () => {
    const { c } = client([{ body: DETAILS }]);
    const d = await c.cardDetails('card_1');
    assert.ok(!redactToString(`paying with ${d.pan}`).includes('4111'), 'registered while in use');

    forgetCardDetails(d);

    // Still masked afterwards, but now by the Luhn heuristic rather than by the
    // registry — which is the whole point of layering the two.
    assert.ok(!redactToString(`pan ${d.pan}`).includes('4111'));
  });

  it('guards the CVV by key, because three digits are too short to register', async () => {
    // registerSecret ignores values under 4 characters on purpose: masking every
    // occurrence of "737" would shred price logs and SKU ids. So the CVV's
    // protection is structural — it is masked whenever it appears under a
    // cvv-shaped key, and it is never written as a bare string anywhere.
    const { c } = client([{ body: DETAILS }]);
    const d = await c.cardDetails('card_1');

    const asObject = redactToString({ cvv: d.cvv, securityCode: d.cvv });
    assert.ok(!asObject.includes('737'), asObject);

    // Documented gap, asserted so a future change to the threshold is noticed:
    // a loose three-digit CVV in a plain string is NOT caught.
    assert.ok(redactToString(`code ${d.cvv}`).includes('737'));
  });

  it('never returns expiry or PAN through a key the redactor would miss', async () => {
    const { c } = client([{ body: DETAILS }]);
    const d = await c.cardDetails('card_1');
    // Whole-object redaction is what MCP responses go through; assert it is
    // safe to pass the details object to it by accident.
    const whole = redactToString(d);
    assert.ok(!whole.includes('4111'), whole);
    assert.ok(!whole.includes('737'), whole);
  });

  it('tolerates being asked to forget nothing', () => {
    assert.doesNotThrow(() => forgetCardDetails(undefined));
  });
});

describe('3DS', () => {
  const CH = [
    { id: 'c1', card_id: 'card_1', merchant: 'DIA', amount: 14.62, otp: '884213', status: 'pending', expires_at: '' },
    { id: 'c2', card_id: 'card_2', merchant: 'OTHER', amount: 1, otp: '119900', status: 'pending', expires_at: '' },
  ];

  it('filters to the card we are paying with', async () => {
    const { c } = client([{ body: CH }]);
    const out = await c.threeDsChallenges('card_1');
    assert.deepEqual(out.map((x) => x.id), ['c1']);
  });

  it('returns everything when no card is given', async () => {
    const { c } = client([{ body: { challenges: CH } }]);
    assert.equal((await c.threeDsChallenges()).length, 2);
  });

  it('registers OTPs as secrets', async () => {
    const { c } = client([{ body: CH }]);
    await c.threeDsChallenges('card_1');
    assert.ok(!redactToString('otp is 884213').includes('884213'));
  });

  it('does not register the OTP of a card it filtered out', async () => {
    const { c } = client([{ body: CH }]);
    await c.threeDsChallenges('card_1');
    assert.ok(redactToString('other 119900').includes('119900'));
  });
});

describe('transactions', () => {
  it('passes card and type filters as query parameters', async () => {
    const { c, calls } = client([{ body: [] }]);
    await c.transactions({ cardId: 'card_1', type: 'settlement' });
    assert.match(calls[0].url, /card_id=card_1/);
    assert.match(calls[0].url, /type=settlement/);
  });

  it('omits absent filters rather than sending "undefined"', async () => {
    const { c, calls } = client([{ body: [] }]);
    await c.transactions();
    assert.ok(!calls[0].url.includes('undefined'), calls[0].url);
    assert.ok(!calls[0].url.includes('?'), calls[0].url);
  });

  it('accepts the wrapped {data:[...]} shape', async () => {
    const { c } = client([{ body: { data: [{ id: 't1' }] } }]);
    assert.equal((await c.transactions()).length, 1);
  });
});

describe('money conversion', () => {
  it('round-trips cents through dollars', () => {
    for (const cents of [100, 1462, 99_999, 500_000]) {
      assert.equal(toCents(toUsd(cents)), cents);
    }
  });

  it('does not lose a cent to float representation', () => {
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(toUsd(1462), 14.62);
  });

  it('formats for the chat summary', () => {
    assert.equal(formatUsd(1462), '$14.62');
    assert.equal(formatUsd(CARD_MAX_CENTS), '$5,000.00');
  });
});
