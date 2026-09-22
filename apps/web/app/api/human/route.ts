import { NextResponse } from 'next/server';

import {
  humanCookieOptions,
  humanGateMode,
  HUMAN_COOKIE,
  mintHumanToken,
  readCookie,
  soloHumanosResponse,
  turnstileSecret,
  turnstileSiteKey,
  verifyHumanToken,
  verifyTurnstile,
} from '../../../lib/human-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = {
  'cache-control': 'private, no-store',
  vary: 'cookie',
} as const;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Attach the httpOnly human cookie. Host-only, Lax, Secure in production. */
function withHumanCookie(body: unknown, token: string, status = 200): NextResponse {
  const res = json(body, status);
  const opts = humanCookieOptions();
  res.cookies.set({
    name: HUMAN_COOKIE,
    value: token,
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
  });
  return res;
}

/** GET — is the current cookie valid? Always includes the public site key when we have one. */
export async function GET(req: Request): Promise<Response> {
  const mode = humanGateMode();
  const siteKey = turnstileSiteKey();
  if (mode === 'open') {
    return json({ ok: true, mode: 'open', siteKey });
  }
  if (mode === 'closed') {
    console.error('[changuito] human-gate CLOSED on GET /api/human.', {
      hasSiteKey: Boolean(siteKey),
      hasSecret: Boolean(turnstileSecret()),
    });
    return json({ ok: false, mode: 'closed', siteKey, error: 'solo_humanos' }, 403);
  }
  const secret = turnstileSecret();
  const token = readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
  const ok = await verifyHumanToken(token, secret);
  return json({ ok, mode: 'enforce', siteKey }, ok ? 200 : 401);
}

/** POST { token } — verify Turnstile and set httpOnly human cookie. */
export async function POST(req: Request): Promise<Response> {
  const mode = humanGateMode();
  if (mode === 'open') {
    const secret = turnstileSecret() || 'dev-only-not-for-prod';
    const minted = await mintHumanToken(secret);
    return withHumanCookie({ ok: true, mode: 'open' }, minted);
  }
  const secret = turnstileSecret();
  if (!secret) {
    return soloHumanosResponse();
  }

  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return json({ error: 'token_required' }, 400);
  }
  const turnstileToken = typeof body.token === 'string' ? body.token.trim() : '';
  if (!turnstileToken) {
    return json({ error: 'token_required' }, 400);
  }

  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const valid = await verifyTurnstile(turnstileToken, secret, ip);
  if (!valid) {
    return json(
      { error: 'turnstile_failed', message: 'No pudimos verificar que sos una persona.' },
      403,
    );
  }

  const minted = await mintHumanToken(secret);
  return withHumanCookie({ ok: true, mode: 'enforce' }, minted);
}
