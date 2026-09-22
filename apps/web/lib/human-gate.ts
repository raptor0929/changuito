/**
 * Human-only gate for the shopper app.
 *
 * AI crawlers/agents must not burn Anthropic / supermarket / chain quota.
 * Humans prove themselves once via Cloudflare Turnstile; we mint a short-lived
 * httpOnly cookie. APIs refuse without it in production.
 */

import { SOLO_HUMANOS } from './human-gate-ui.ts';

export { SOLO_HUMANOS, HUMAN_REQUIRED_EVENT, clientGateDecision, notifyHumanRequired } from './human-gate-ui.ts';
export type { ClientGateDecision } from './human-gate-ui.ts';

export const HUMAN_COOKIE = 'chg_human';
export const HUMAN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export type GateMode = 'open' | 'enforce' | 'closed';

function nonempty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Turnstile env.
 *
 * Next and Vercel only ship a variable that the source mentions as
 * `process.env.NAME`. A bracket lookup alone is invisible to that pass, so
 * production reported both keys missing and the shopper never mounted the
 * widget. The literal member expressions below are the ones the bundler sees.
 * Bracket access still wins when the lambda has a runtime value the build
 * did not inline.
 *
 * The secret is what makes the gate real. The site key is public and is what
 * the widget needs; a missing site-key read must not flip production to
 * `closed` when the secret is set, or every API 403s before Turnstile can run.
 */
export function turnstileSecret(env: NodeJS.ProcessEnv = process.env): string {
  const own = nonempty(env.TURNSTILE_SECRET_KEY) || nonempty(env['TURNSTILE_SECRET_KEY']);
  if (own) return own;
  if (env !== process.env) return '';
  return nonempty(process.env.TURNSTILE_SECRET_KEY);
}

export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env): string {
  const own =
    nonempty(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ||
    nonempty(env['NEXT_PUBLIC_TURNSTILE_SITE_KEY']) ||
    nonempty(env.TURNSTILE_SITE_KEY);
  if (own) return own;
  if (env !== process.env) return '';
  return nonempty(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

/** Dev without a secret: open. Prod without a secret: closed. Secret set: enforce. */
export function humanGateMode(env: NodeJS.ProcessEnv = process.env): GateMode {
  if (turnstileSecret(env)) return 'enforce';
  if (env.NODE_ENV === 'production') return 'closed';
  return 'open';
}

export function soloHumanosResponse(status = 403): Response {
  return Response.json(
    { error: SOLO_HUMANOS, message: 'Changuito es solo para personas. Completá la verificación.' },
    { status },
  );
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  // btoa is available in Edge and modern Node.
  const b64 = btoa(s);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

export async function mintHumanToken(
  secret: string,
  now = Date.now(),
  ttlMs = HUMAN_TTL_MS,
): Promise<string> {
  const exp = now + ttlMs;
  const payload = String(exp);
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyHumanToken(
  token: string | undefined | null,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = await hmac(secret, payload);
  if (expected.length !== sig.length) return false;
  // Constant-time-ish compare for equal-length strings.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export type HumanCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

/**
 * Host-only cookie (no Domain): it must stick to app.changuito.me and must
 * not be shared with www. SameSite=Lax is sent on same-origin fetch, which
 * is how /api/chat is called. Secure only in production so http://localhost
 * can still store it.
 */
export function humanCookieOptions(env: NodeJS.ProcessEnv = process.env): HumanCookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(HUMAN_TTL_MS / 1000),
  };
}

export function humanCookieHeader(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const opts = humanCookieOptions(env);
  const secure = opts.secure ? '; Secure' : '';
  return `${HUMAN_COOKIE}=${encodeURIComponent(token)}; Path=${opts.path}; HttpOnly; SameSite=Lax; Max-Age=${opts.maxAge}${secure}`;
}

/** Verify Turnstile token with Cloudflare siteverify. */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteip?: string | null,
): Promise<boolean> {
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteip) body.set('remoteip', remoteip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}

/**
 * Gate an API handler. Returns a Response to return immediately, or null to proceed.
 * Call at the top of every cost-bearing route.
 */
export async function requireHuman(req: Request, env: NodeJS.ProcessEnv = process.env): Promise<Response | null> {
  const mode = humanGateMode(env);
  if (mode === 'open') {
    if (!(globalThis as { __chgHumanWarned?: boolean }).__chgHumanWarned) {
      (globalThis as { __chgHumanWarned?: boolean }).__chgHumanWarned = true;
      console.warn(
        '[changuito] human-gate OPEN (dev): set NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY to enforce.',
      );
    }
    return null;
  }
  if (mode === 'closed') {
    console.error('[changuito] human-gate CLOSED: Turnstile keys missing in production.', {
      hasSiteKey: Boolean(turnstileSiteKey(env)),
      hasSecret: Boolean(turnstileSecret(env)),
    });
    return soloHumanosResponse();
  }

  const secret = turnstileSecret(env);
  const token = readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
  const ok = await verifyHumanToken(token, secret);
  if (!ok) return soloHumanosResponse();
  return null;
}

/** Known AI / training crawlers — shopper is humans-only. */
export const AI_BOT_UA =
  /GPTBot|ChatGPT-User|Google-Extended|ClaudeBot|anthropic-ai|Anthropic|Bytespider|CCBot|Amazonbot|PerplexityBot|Diffbot|FacebookBot|meta-externalagent|cohere-ai|Cohere|Applebot-Extended|Omgilibot|Omgili|Diffbot|YouBot|ImagesiftBot|Ai2Bot|Timpibot|Webzio-Extended|PetalBot|Scrapy|python-requests|curl\/|wget\/|Go-http-client|aiohttp|httpx|node-fetch|axios\//i;

/** Conservative browser-ish Accept check for /api (fetch-like clients). */
export function acceptLooksLikeBrowserFetch(accept: string | null): boolean {
  if (!accept || !accept.trim()) return false;
  const a = accept.toLowerCase();
  if (a.includes('*/*')) return true;
  if (a.includes('application/json')) return true;
  if (a.includes('text/event-stream')) return true; // chat SSE
  if (a.includes('text/plain')) return true;
  // Classic crawler Accept is often just text/html
  if (a.startsWith('text/html') && !a.includes('application/')) return false;
  return false;
}

export function hasBrowserFetchHints(req: Request): boolean {
  const accept = req.headers.get('accept');
  if (acceptLooksLikeBrowserFetch(accept)) return true;
  // Modern browsers send Sec-Fetch-* on same-origin API calls.
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'same-site') return true;
  const origin = req.headers.get('origin');
  if (origin) return true;
  return false;
}
