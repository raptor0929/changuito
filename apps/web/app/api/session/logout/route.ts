import { clearUserCookieHeader } from '../../../../lib/login-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/session/logout — clear the chg_user cookie. */
export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': clearUserCookieHeader(),
    },
  });
}
