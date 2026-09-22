/**
 * Guest free-turn gate for /api/chat.
 *
 * Guests get FREE_TURNS chat POSTs per sessionId (and a softer IP ceiling so
 * rotating sessionIds cannot burn Anthropic forever). After Pollar login the
 * client hits /api/session/login, which sets an httpOnly `chg_user` cookie;
 * with that cookie the counter is skipped.
 *
 * Redis when available (same credentials as turn-store); otherwise an
 * in-memory map with TTL — same compromise as turn-store on a single box.
 */

import { Redis } from '@upstash/redis';

import { readCookie } from './human-gate.ts';
import {
  FREE_TURNS,
  FREE_TURNS_PER_IP,
  LOGIN_REQUIRED,
  LOGIN_REQUIRED_MESSAGE,
  USER_COOKIE,
} from './login-constants.ts';

export {
  FREE_TURNS,
  FREE_TURNS_PER_IP,
  LOGIN_CTA,
  LOGIN_REQUIRED,
  LOGIN_REQUIRED_MESSAGE,
  USER_COOKIE,
} from './login-constants.ts';

const TTL_SECONDS = 60 * 60; // match turn-store: abandon after an hour
const USER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const KEY_SESSION = (sessionId: string) => `changuito:guest-turns:${sessionId}`;
const KEY_IP = (ip: string) => `changuito:guest-turns-ip:${ip}`;

// ---------------------------------------------------------------- cookie

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Prefer a dedicated secret; fall back to Turnstile secret; then a local-only default. */
export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const dedicated = (env.CHG_SESSION_SECRET ?? '').trim();
  if (dedicated) return dedicated;
  const turnstile = (env.TURNSTILE_SECRET_KEY ?? '').trim();
  if (turnstile) return turnstile;
  return 'dev-chg-session-not-for-prod';
}

/**
 * Token format: `exp.address.sig` where address is base64url(utf8) so it can
 * contain any Stellar G… / C… character without cookie headaches.
 */
export async function mintUserToken(
  address: string,
  secret: string,
  now = Date.now(),
  ttlMs = USER_TTL_MS,
): Promise<string> {
  const exp = String(now + ttlMs);
  const addr = btoa(address).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const payload = `${exp}.${addr}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyUserToken(
  token: string | undefined | null,
  secret: string,
  now = Date.now(),
): Promise<{ ok: true; address: string } | { ok: false }> {
  if (!token) return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false };
  const [expStr, addrB64, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return { ok: false };
  const expected = await hmac(secret, `${expStr}.${addrB64}`);
  if (expected.length !== sig.length) return { ok: false };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return { ok: false };
  try {
    const pad = addrB64.length % 4 === 0 ? '' : '='.repeat(4 - (addrB64.length % 4));
    const b64 = addrB64.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const address = atob(b64);
    if (!address || address.length < 8) return { ok: false };
    return { ok: true, address };
  } catch {
    return { ok: false };
  }
}

export function userCookieHeader(token: string, maxAgeSec = USER_TTL_MS / 1000): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${USER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeSec)}${secure}`;
}

export function clearUserCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function readLoggedInUser(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; address: string } | { ok: false }> {
  const token = readCookie(req.headers.get('cookie'), USER_COOKIE);
  return verifyUserToken(token, sessionSecret(env));
}

export function loginRequiredResponse(turnsUsed = FREE_TURNS): Response {
  return Response.json(
    {
      error: LOGIN_REQUIRED,
      message: LOGIN_REQUIRED_MESSAGE,
      freeTurns: FREE_TURNS,
      turnsUsed,
    },
    { status: 401 },
  );
}

// ---------------------------------------------------------------- counter store

export interface TurnCounter {
  get(key: string): Promise<number>;
  /** Atomically increment and return the new value. */
  incr(key: string): Promise<number>;
  readonly kind: 'redis' | 'memory';
}

function credentials(): { url: string; token: string } | undefined {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : undefined;
}

function redisCounter(url: string, token: string): TurnCounter {
  const redis = new Redis({ url, token });
  return {
    kind: 'redis',
    async get(key) {
      try {
        const n = await redis.get<number>(key);
        return typeof n === 'number' && Number.isFinite(n) ? n : 0;
      } catch (e) {
        console.error('[login-gate] counter read failed:', e);
        return 0;
      }
    },
    async incr(key) {
      try {
        const n = await redis.incr(key);
        // Refresh TTL on every touch so active guests keep their window.
        await redis.expire(key, TTL_SECONDS);
        return typeof n === 'number' ? n : 1;
      } catch (e) {
        console.error('[login-gate] counter incr failed:', e);
        return 1;
      }
    },
  };
}

function memoryCounter(): TurnCounter {
  const map = new Map<string, { n: number; lastUsed: number }>();
  const MAX = 512;

  function prune(now: number) {
    for (const [k, v] of map) {
      if (now - v.lastUsed > TTL_SECONDS * 1000) map.delete(k);
    }
    while (map.size > MAX) {
      const oldest = [...map.entries()].reduce((a, b) => (a[1].lastUsed <= b[1].lastUsed ? a : b));
      map.delete(oldest[0]);
    }
  }

  return {
    kind: 'memory',
    async get(key) {
      const hit = map.get(key);
      if (!hit) return 0;
      if (Date.now() - hit.lastUsed > TTL_SECONDS * 1000) {
        map.delete(key);
        return 0;
      }
      return hit.n;
    },
    async incr(key) {
      const now = Date.now();
      prune(now);
      const hit = map.get(key);
      if (!hit || now - hit.lastUsed > TTL_SECONDS * 1000) {
        map.set(key, { n: 1, lastUsed: now });
        return 1;
      }
      hit.n += 1;
      hit.lastUsed = now;
      return hit.n;
    },
  };
}

let counter: TurnCounter | undefined;

/** Exposed for tests — swap in a fresh memory counter. */
export function __resetTurnCounterForTests(next?: TurnCounter): void {
  counter = next ?? memoryCounter();
}

export function guestTurnCounter(): TurnCounter {
  if (!counter) {
    const creds = credentials();
    counter = creds ? redisCounter(creds.url, creds.token) : memoryCounter();
    console.log(
      counter.kind === 'redis'
        ? '[login-gate] Redis — guest turn counters survive cold starts.'
        : '[login-gate] in-memory guest turn counters (lost on restart).',
    );
  }
  return counter;
}

export function clientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  );
}

export interface GateVerdict {
  allow: boolean;
  /** Turns already used *including* this one when allow=true; or the blocked count. */
  turnsUsed: number;
  reason?: 'login_required' | 'ip_limit';
}

/**
 * Pure decision given current counts. Exported for unit tests.
 * `sessionCount` / `ipCount` are values *before* this attempt.
 */
export function guestChatVerdict(args: {
  loggedIn: boolean;
  sessionCount: number;
  ipCount?: number;
  freeTurns?: number;
  freeTurnsPerIp?: number;
}): GateVerdict {
  if (args.loggedIn) return { allow: true, turnsUsed: 0 };
  const free = args.freeTurns ?? FREE_TURNS;
  const freeIp = args.freeTurnsPerIp ?? FREE_TURNS_PER_IP;
  if (args.sessionCount >= free) {
    return { allow: false, turnsUsed: args.sessionCount, reason: 'login_required' };
  }
  if (args.ipCount !== undefined && args.ipCount >= freeIp) {
    return { allow: false, turnsUsed: args.sessionCount, reason: 'ip_limit' };
  }
  return { allow: true, turnsUsed: args.sessionCount + 1 };
}

/**
 * Gate /api/chat for guests. Returns a Response to return immediately, or null to proceed.
 * Increments counters only when the request is allowed (attempt that consumes a free turn).
 */
export async function requireLoginOrFreeTurn(
  req: Request,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response | null> {
  const user = await readLoggedInUser(req, env);
  if (user.ok) return null;

  const store = guestTurnCounter();
  const sessionCount = await store.get(KEY_SESSION(sessionId));
  const ip = clientIp(req);
  const ipCount = ip ? await store.get(KEY_IP(ip)) : undefined;

  const verdict = guestChatVerdict({ loggedIn: false, sessionCount, ipCount });
  if (!verdict.allow) {
    return loginRequiredResponse(verdict.turnsUsed);
  }

  await store.incr(KEY_SESSION(sessionId));
  if (ip) await store.incr(KEY_IP(ip));
  return null;
}
