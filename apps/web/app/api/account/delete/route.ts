/**
 * POST /api/account/delete { confirm }
 *
 * Deletes the signed-in shopper's Changuito data (lib/account-delete.ts) and
 * ends the session. `confirm` has to be the exact string: a stray POST must
 * not delete. Sign-in here is Pollar / Freighter; there is no separate
 * provider-user delete call, so the answer reports that path as skipped.
 *
 * The Día account and anything already on the public network are not touched. The profile
 * screen says so before this route is called.
 */
import { DELETE_CONFIRM, deleteAccountData } from '../../../../lib/account-delete.ts';
import { clearUserCookieHeader } from '../../../../lib/login-gate.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión.' }, { status: 401, headers: NO_STORE });

  const body = (await req.json().catch(() => null)) as { confirm?: unknown; token?: unknown } | null;
  if (body?.confirm !== DELETE_CONFIRM) {
    return Response.json(
      { error: 'confirm_required', message: 'Confirmá que querés eliminar la cuenta.' },
      { status: 400, headers: NO_STORE },
    );
  }

  let deleted;
  try {
    deleted = await deleteAccountData(user.address);
  } catch (err) {
    console.error('[account-delete]', err instanceof Error ? err.name : 'failed');
    return Response.json(
      { error: 'delete_failed', message: 'No pudimos eliminar la cuenta. Probá de nuevo.' },
      { status: 500, headers: NO_STORE },
    );
  }

  if (process.env.NODE_ENV === 'production' && !deleted.durable) {
    return Response.json(
      {
        error: 'delete_unavailable',
        message: 'Ahora no podemos borrar la cuenta. Probá de nuevo en unos minutos.',
      },
      { status: 503, headers: NO_STORE },
    );
  }

  return new Response(JSON.stringify({ ok: true, privy: 'skipped', durable: deleted.durable }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': clearUserCookieHeader(),
    },
  });
}
