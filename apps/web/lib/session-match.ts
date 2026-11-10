/**
 * `readLoggedInUser`, plus the check that the cookie is for the wallet the
 * browser says it is acting for (lib/wallet-header.ts). Used by every route
 * that reads or writes one account's data.
 *
 * Without the header the answer is the cookie's, as before: an old bundle or
 * a script keeps working. With it, a cookie for another wallet is refused
 * rather than answered — the answer would be someone else's profile.
 */
import { inLang, langFromCookieHeader } from './lang.ts';
import { readLoggedInUser } from './login-gate.ts';
import { SESSION_MISMATCH, WALLET_HEADER } from './wallet-header.ts';

export type SessionUser = { ok: true; address: string } | { ok: false; mismatch?: true };

export async function readSessionUser(req: Request, env: NodeJS.ProcessEnv = process.env): Promise<SessionUser> {
  const user = await readLoggedInUser(req, env);
  if (!user.ok) return user;
  const claimed = req.headers.get(WALLET_HEADER)?.trim();
  if (claimed && claimed !== user.address) return { ok: false, mismatch: true };
  return user;
}

/**
 * What the shopper reads if the automatic re-mint and retry (lib/fetch-as.ts)
 * still lands on another account: why nothing was shown, and that it is safe.
 */
export const SESSION_MISMATCH_MESSAGE = {
  es: 'Tu sesión cambió de cuenta. Por seguridad no mostramos datos de otra cuenta; probá de nuevo.',
  en: "Your session switched accounts. For your security we don't show another account's data; try again.",
} as const;

/** The refusal for a cookie that names another wallet. The client re-mints and retries. */
export function sessionMismatchResponse(req?: Request): Response {
  const lang = langFromCookieHeader(req?.headers.get('cookie'));
  return Response.json(
    { error: SESSION_MISMATCH, message: inLang(lang, SESSION_MISMATCH_MESSAGE) },
    { status: 409, headers: { 'cache-control': 'no-store' } },
  );
}
