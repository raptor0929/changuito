import type { SessionSnapshot } from '@changuito/mcp/session';

import { bootMcp, closeMcp, type McpPair } from './boot';

/**
 * Sessions, on a host that does not promise to keep anything.
 *
 * A Vercel lambda's module scope is a cache, not a database: instances are
 * recycled on deploy, on idle and on scale-out, and two messages from the same
 * user can land on different ones. So this keeps a warm Map for speed and
 * treats the snapshot the browser sends as the record of truth.
 *
 * Putting the record in the browser rather than in a KV store is deliberate.
 * The snapshot holds a postal code, a sales channel and a cart id — and the
 * cart id is something the app already hands the user as a URL, so there is
 * nothing in it they do not have. That buys durability across cold starts with
 * no store to provision, and it makes two browser tabs two shoppers, which is
 * what a user would expect.
 */
export interface Session extends McpPair {
  id: string;
  lastUsed: number;
  /** Serializes turns, so two tabs on one id cannot interleave cart writes. */
  queue: Promise<unknown>;
}

const sessions = new Map<string, Session>();

const MAX_SESSIONS = 24;
const IDLE_MS = 30 * 60_000;

async function evictStale(now: number): Promise<void> {
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) {
      sessions.delete(id);
      await closeMcp(s).catch(() => {});
    }
  }
  // Still over budget: drop the least recently used. A dropped session is not
  // a lost one — the next request rehydrates it from the browser's snapshot.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].reduce((a, b) => (a[1].lastUsed <= b[1].lastUsed ? a : b));
    sessions.delete(oldest[0]);
    await closeMcp(oldest[1]).catch(() => {});
  }
}

async function getOrCreate(id: string, snapshot?: SessionSnapshot): Promise<Session> {
  const now = Date.now();
  const warm = sessions.get(id);
  if (warm) {
    warm.lastUsed = now;
    return warm;
  }

  const pair = await bootMcp();
  // Restore before the first tool call, or `ensureCart` mints an empty cart and
  // `get_cart_link` hands the user a link to it — a wrong answer with no error.
  if (snapshot) pair.state.restore(snapshot);

  const session: Session = { id, ...pair, lastUsed: now, queue: Promise.resolve() };
  sessions.set(id, session);
  await evictStale(now);
  return session;
}

/**
 * Run one turn against a session, with the next turn on the same id queued
 * behind it. Returns the session's snapshot alongside the result so the caller
 * can hand it back to the browser.
 */
export async function withSession<T>(
  id: string,
  snapshot: SessionSnapshot | undefined,
  fn: (s: Session) => Promise<T>,
): Promise<{ result: T; snapshot: SessionSnapshot }> {
  const session = await getOrCreate(id, snapshot);

  const turn = session.queue.then(
    () => fn(session),
    () => fn(session), // a failed predecessor must not poison the queue
  );
  session.queue = turn.catch(() => {});

  const result = await turn;
  session.lastUsed = Date.now();
  return { result, snapshot: session.state.snapshot() };
}

/** Test and shutdown seam; nothing in a request path should need it. */
export async function resetSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((s) => closeMcp(s).catch(() => {})));
}

export const sessionCount = (): number => sessions.size;
