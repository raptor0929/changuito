import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountDecision, OWNER_KEY, wipeLocalAccount } from '../local-account.ts';
import { mintUserToken, USER_COOKIE } from '../login-gate.ts';
import { readSessionUser } from '../session-match.ts';
import { WALLET_HEADER } from '../wallet-header.ts';

const A = 'So11111111111111111111111111111111111111112';
const B = 'Fvvp2htq2ozDkzkJhabvU7cJybgvR21rBDEd4TAHF7Sq';
const SECRET = 'test-secret-for-account-isolation';
const ENV = { CHG_SESSION_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;

/** A Storage stand-in with the parts the wipe uses. */
function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

async function request(cookieFor: string | null, claimed?: string): Promise<Request> {
  const headers: Record<string, string> = {};
  if (cookieFor) headers.cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(cookieFor, SECRET))}`;
  if (claimed) headers[WALLET_HEADER] = claimed;
  return new Request('https://x.test/api/profile', { headers });
}

describe("whose chats are in this browser", () => {
  it('waits until Privy has answered, and while the wallet is being created', () => {
    assert.equal(accountDecision({ ready: false, authenticated: false, address: null, owner: A }), 'wait');
    assert.equal(accountDecision({ ready: true, authenticated: true, address: null, owner: A }), 'wait');
  });

  it("wipes another account's chats when a different wallet signs in", () => {
    assert.equal(accountDecision({ ready: true, authenticated: true, address: B, owner: A }), 'wipe');
  });

  it('wipes when the owner signed out and nobody is signed in', () => {
    assert.equal(accountDecision({ ready: true, authenticated: false, address: null, owner: A }), 'wipe');
  });

  it("keeps the same account's chats, and a guest's", () => {
    assert.equal(accountDecision({ ready: true, authenticated: true, address: A, owner: A }), 'keep');
    assert.equal(accountDecision({ ready: true, authenticated: false, address: null, owner: null }), 'keep');
  });

  it("adopts a guest's chats for whoever signs in", () => {
    assert.equal(accountDecision({ ready: true, authenticated: true, address: A, owner: null }), 'adopt');
  });
});

describe('the wipe', () => {
  it('removes every changuito key, the owner included, and nothing else', () => {
    const s = storage({
      'changuito:chats': '[]',
      'changuito:chat:1': '{"receipt":{}}',
      [OWNER_KEY]: A,
      'privy:token': 'privy owns this',
      unrelated: 'x',
    });
    wipeLocalAccount([s]);
    assert.deepEqual([...s.map.keys()].sort(), ['privy:token', 'unrelated']);
  });
});

describe('the session cookie must be the wallet the browser means', () => {
  it("refuses a cookie for another wallet instead of answering with that wallet's data", async () => {
    const user = await readSessionUser(await request(A, B), ENV);
    assert.equal(user.ok, false);
    assert.equal(!user.ok && user.mismatch, true);
  });

  it('answers when they agree', async () => {
    assert.deepEqual(await readSessionUser(await request(B, B), ENV), { ok: true, address: B });
  });

  it('still answers a request that names no wallet, as before', async () => {
    assert.deepEqual(await readSessionUser(await request(A), ENV), { ok: true, address: A });
  });

  it('a header is a claim, not an identity: without a cookie it is nobody', async () => {
    const user = await readSessionUser(await request(null, A), ENV);
    assert.equal(user.ok, false);
    assert.equal(!user.ok && user.mismatch, undefined);
  });
});
