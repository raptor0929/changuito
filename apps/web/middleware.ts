import { NextResponse, type NextRequest } from 'next/server';

import {
  AI_BOT_UA,
  hasBrowserFetchHints,
  HUMAN_COOKIE,
  humanGateMode,
  readCookie,
  verifyHumanToken,
} from './lib/human-gate';

export async function middleware(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? '';
  if (AI_BOT_UA.test(ua)) {
    return new NextResponse('Solo humanos.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const path = req.nextUrl.pathname;

  // Conservative non-browser reject on APIs (keep UI fetch working).
  if (path.startsWith('/api/') && path !== '/api/human') {
    if (!hasBrowserFetchHints(req)) {
      return NextResponse.json(
        { error: 'solo_humanos', message: 'Changuito es solo para personas.' },
        { status: 403 },
      );
    }

    // Early cookie check when enforcing (route handlers re-check).
    const mode = humanGateMode(process.env);
    if (mode === 'closed') {
      return NextResponse.json(
        { error: 'solo_humanos', message: 'Changuito es solo para personas. Completá la verificación.' },
        { status: 403 },
      );
    }
    if (mode === 'enforce') {
      const secret = (process.env.TURNSTILE_SECRET_KEY ?? '').trim();
      const token = readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
      const ok = await verifyHumanToken(token, secret);
      if (!ok) {
        return NextResponse.json(
          { error: 'solo_humanos', message: 'Changuito es solo para personas. Completá la verificación.' },
          { status: 403 },
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets / next internals; gate pages + APIs for bots.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)'],
};
