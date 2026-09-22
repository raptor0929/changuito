import {
  mintUserToken,
  sessionSecret,
  userCookieHeader,
} from '../../../../lib/login-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/session/login { address }
 *
 * Called after Pollar client login. Stores wallet address in a signed httpOnly
 * cookie (`chg_user`) so /api/chat can skip the guest free-turn limit.
 *
 * Pragmatic: we trust the browser already proved the address to Pollar; the
 * cookie only binds that claim to subsequent same-origin API calls. A dedicated
 * Pollar server-side verify can replace this later without changing the cookie
 * shape.
 */
export async function POST(req: Request): Promise<Response> {
  let address: string;
  try {
    const body = (await req.json()) as { address?: unknown };
    address = typeof body.address === 'string' ? body.address.trim() : '';
  } catch {
    return Response.json({ error: 'expected_json' }, { status: 400 });
  }

  // Stellar account (G…) or contract (C…) — keep the check light; Pollar already
  // authenticated the user on the client.
  if (!/^[GC][A-Z2-7]{55}$/.test(address)) {
    return Response.json({ error: 'invalid_address' }, { status: 400 });
  }

  const secret = sessionSecret();
  const token = await mintUserToken(address, secret);
  return new Response(JSON.stringify({ ok: true, address }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': userCookieHeader(token),
    },
  });
}
