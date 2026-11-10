import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * GET/PUT /api/profile as handlers (development store, no database). The Día
 * password goes in and never comes out; an empty password box keeps the saved
 * one; one wallet never reads another's row; and when the profile cannot be
 * opened, the shopper reads that their data is safe while the log names the
 * missing setting, never a value.
 */
const env = process.env as Record<string, string | undefined>;
delete env.DATABASE_URL;
env.NODE_ENV = 'test';
env.CHG_SESSION_SECRET = 'session-test-secret';
const KEY = randomBytes(32).toString('base64');
env.PROFILE_ENC_KEY = KEY;

const BUYER = 'BuyerWallet11111111111111111111111111111111';
const OTHER = 'OtherWallet11111111111111111111111111111111';
const PASSWORD = 'not-a-real-password-42';

describe('/api/profile', () => {
  let GET: (req: Request) => Promise<Response>;
  let PUT: (req: Request) => Promise<Response>;
  let buyer: string;
  let other: string;
  let logs: string[] = [];
  const realError = console.error;

  before(async () => {
    const { mintUserToken } = await import('../login-gate.ts');
    buyer = `chg_user=${encodeURIComponent(await mintUserToken(BUYER, 'session-test-secret'))}`;
    other = `chg_user=${encodeURIComponent(await mintUserToken(OTHER, 'session-test-secret'))}`;
    ({ GET, PUT } = await import('../../app/api/profile/route.ts'));
  });
  beforeEach(() => {
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    env.PROFILE_ENC_KEY = KEY;
  });
  after(() => void (console.error = realError));

  const get = (cookie: string, headers: Record<string, string> = {}) =>
    GET(new Request('https://app.changuito.me/api/profile', { headers: { cookie, ...headers } }));
  const put = (cookie: string, body: unknown) =>
    PUT(
      new Request('https://app.changuito.me/api/profile', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('saves, and never sends the password back', async () => {
    const res = await put(buyer, { email: 'shopper@example.com', password: PASSWORD, dni: '30123456', postcode: '1425' });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(PASSWORD));
    const body = JSON.parse(text);
    assert.equal(body.hasPassword, true);
    assert.equal(body.complete, true);

    const read = await get(buyer);
    const readText = await read.text();
    assert.ok(!readText.includes(PASSWORD));
    assert.equal(JSON.parse(readText).email, 'shopper@example.com');
    assert.equal(read.headers.get('cache-control'), 'no-store');
  });

  it('an empty password box keeps the saved password', async () => {
    const res = await put(buyer, { postcode: '1414', password: '' });
    const body = await res.json();
    assert.equal(body.postcode, '1414');
    assert.equal(body.hasPassword, true);
  });

  it('one wallet never reads another’s row', async () => {
    const body = await (await get(other)).json();
    assert.equal(body.email, null);
    assert.equal(body.hasPassword, false);
  });

  it('rejects bad input with a message and logs nothing from the body', async () => {
    const res = await put(buyer, { email: 'not-an-email', password: PASSWORD });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /email/);
    assert.ok(!logs.join('\n').includes(PASSWORD));
  });

  it('503 reassures the shopper (ES and EN) and logs only the missing setting', async () => {
    delete env.PROFILE_ENC_KEY;
    const { PROFILE_UNAVAILABLE } = await import('../profile-copy.ts');
    const es = await put(buyer, { email: 'shopper@example.com', password: PASSWORD, dni: '30123456' });
    assert.equal(es.status, 503);
    assert.equal((await es.json()).error, PROFILE_UNAVAILABLE.es);
    assert.match(PROFILE_UNAVAILABLE.es, /siguen guardados/);

    const en = await get(`${buyer}; chg_lang=en`);
    assert.equal(en.status, 503);
    assert.equal((await en.json()).error, PROFILE_UNAVAILABLE.en);

    const log = logs.join('\n');
    assert.match(log, /PROFILE_ENC_KEY/);
    assert.ok(!log.includes(PASSWORD) && !log.includes('shopper@example.com'));
  });

  it('a cookie for another wallet gets the session-mismatch answer, in the shopper’s language', async () => {
    const { SESSION_MISMATCH_MESSAGE } = await import('../session-match.ts');
    const { WALLET_HEADER } = await import('../wallet-header.ts');
    const es = await get(buyer, { [WALLET_HEADER]: OTHER });
    assert.equal(es.status, 409);
    const body = await es.json();
    assert.equal(body.error, 'session_mismatch');
    assert.equal(body.message, SESSION_MISMATCH_MESSAGE.es);
    const en = await get(`${buyer}; chg_lang=en`, { [WALLET_HEADER]: OTHER });
    assert.equal((await en.json()).message, SESSION_MISMATCH_MESSAGE.en);
  });
});
