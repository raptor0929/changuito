import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { ensureUserCookie, forgetUserCookie } from '../session-login.ts';

const ADDRESS = 'GA' + 'B'.repeat(54);

/** Swap in a fetch that counts calls and resolves when we say so. */
function stubFetch(reply: () => Promise<Response>) {
  const calls: string[] = [];
  (globalThis as { fetch: unknown }).fetch = (input: unknown, init?: { body?: string }) => {
    calls.push(String(init?.body ?? ''));
    return reply();
  };
  return calls;
}

const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));
const denied = () => Promise.resolve(new Response('{"error":"invalid_address"}', { status: 400 }));

beforeEach(forgetUserCookie);

describe('ensureUserCookie', () => {
  it('mints once for two callers racing the same login', async () => {
    const calls = stubFetch(ok);
    const [a, b] = await Promise.all([ensureUserCookie(ADDRESS), ensureUserCookie(ADDRESS)]);
    assert.equal(calls.length, 1);
    assert.deepEqual([a, b], [true, true]);
    assert.match(calls[0]!, /GAB/);
  });

  it('remembers a success, so a later caller does not re-mint', async () => {
    const calls = stubFetch(ok);
    await ensureUserCookie(ADDRESS);
    await ensureUserCookie(ADDRESS);
    assert.equal(calls.length, 1);
  });

  it('does not remember a failure — the next caller gets a real attempt', async () => {
    const calls = stubFetch(denied);
    assert.equal(await ensureUserCookie(ADDRESS), false);
    assert.equal(await ensureUserCookie(ADDRESS), false);
    assert.equal(calls.length, 2);
  });

  it('reports false rather than throwing when the network is gone', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    assert.equal(await ensureUserCookie(ADDRESS), false);
  });

  it('mints again for a different address', async () => {
    const calls = stubFetch(ok);
    await ensureUserCookie(ADDRESS);
    await ensureUserCookie('GC' + 'D'.repeat(54));
    assert.equal(calls.length, 2);
  });

  it('forgets on logout, so logging back in re-mints', async () => {
    const calls = stubFetch(ok);
    await ensureUserCookie(ADDRESS);
    forgetUserCookie();
    await ensureUserCookie(ADDRESS);
    assert.equal(calls.length, 2);
  });

  it('force remints after a remembered success', async () => {
    const calls = stubFetch(ok);
    await ensureUserCookie(ADDRESS);
    assert.equal(await ensureUserCookie(ADDRESS, { force: true }), true);
    assert.equal(calls.length, 2);
  });

  it('force waits on the in-flight mint instead of firing a second one', async () => {
    const calls = stubFetch(ok);
    const [a, b] = await Promise.all([ensureUserCookie(ADDRESS), ensureUserCookie(ADDRESS, { force: true })]);
    assert.deepEqual([a, b], [true, true]);
    assert.equal(calls.length, 1);
  });
});
