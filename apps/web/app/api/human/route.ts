import {
  humanCookieHeader,
  humanGateMode,
  HUMAN_COOKIE,
  mintHumanToken,
  readCookie,
  soloHumanosResponse,
  verifyHumanToken,
  verifyTurnstile,
} from '../../../lib/human-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — is the current cookie valid? */
export async function GET(req: Request): Promise<Response> {
  const mode = humanGateMode();
  if (mode === 'open') {
    return Response.json({ ok: true, mode: 'open' });
  }
  if (mode === 'closed') {
    return Response.json({ ok: false, mode: 'closed', error: 'solo_humanos' }, { status: 403 });
  }
  const secret = (process.env.TURNSTILE_SECRET_KEY ?? '').trim();
  const token = readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
  const ok = await verifyHumanToken(token, secret);
  return Response.json({ ok, mode: 'enforce' }, { status: ok ? 200 : 401 });
}

/** POST { token } — verify Turnstile and set httpOnly human cookie. */
export async function POST(req: Request): Promise<Response> {
  const mode = humanGateMode();
  if (mode === 'open') {
    const secret = (process.env.TURNSTILE_SECRET_KEY ?? '').trim() || 'dev-only-not-for-prod';
    const minted = await mintHumanToken(secret);
    return new Response(JSON.stringify({ ok: true, mode: 'open' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': humanCookieHeader(minted),
      },
    });
  }
  if (mode === 'closed') {
    return soloHumanosResponse();
  }

  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return Response.json({ error: 'token_required' }, { status: 400 });
  }
  const turnstileToken = typeof body.token === 'string' ? body.token.trim() : '';
  if (!turnstileToken) {
    return Response.json({ error: 'token_required' }, { status: 400 });
  }

  const secret = (process.env.TURNSTILE_SECRET_KEY ?? '').trim();
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const valid = await verifyTurnstile(turnstileToken, secret, ip);
  if (!valid) {
    return Response.json(
      { error: 'turnstile_failed', message: 'No pudimos verificar que sos una persona.' },
      { status: 403 },
    );
  }

  const minted = await mintHumanToken(secret);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': humanCookieHeader(minted),
    },
  });
}
