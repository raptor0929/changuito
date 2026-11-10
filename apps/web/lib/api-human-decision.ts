/**
 * The human-gate decision middleware applies to a request.
 *
 * Kept out of middleware.ts so the tests can load it under
 * `node --experimental-strip-types` (that runner cannot import `next/server`,
 * and it cannot follow an extensionless relative import). Middleware is a
 * thin wrapper around this function: a native wallet route is allowed
 * through here, and the route handler still has to authenticate it.
 */
import { isCheckoutServiceCallback } from './service-callback.ts';
import {
  AI_BOT_UA,
  hasBrowserFetchHints,
  HUMAN_COOKIE,
  humanGateMode,
  readCookie,
  turnstileSecret,
  verifyHumanToken,
} from './human-gate.ts';

/** There is no phone-wallet session on this chain. The path stays in the copied gate so the rest of the decision is unchanged. */
function isNativeWalletSessionRoute(_path: string, _method: string): boolean {
  return false;
}

export const HUMANS_ONLY = 'Changuito es solo para personas.';
export const HUMANS_VERIFY = 'Changuito es solo para personas. Completá la verificación.';

export interface HumanGateCookieJar {
  get(name: string): { value: string } | undefined;
}

export type ApiHumanDecision = { kind: 'allow' } | { kind: 'bot' } | { kind: 'humans'; message: string };

export async function apiHumanDecision(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  cookies?: HumanGateCookieJar,
): Promise<ApiHumanDecision> {
  const path = new URL(req.url).pathname;
  // The service worker has no browser hints and no Turnstile cookie.
  // Its handler checks a bearer of its own.
  if (isCheckoutServiceCallback(path, req.method)) return { kind: 'allow' };

  const ua = req.headers.get('user-agent') ?? '';
  if (AI_BOT_UA.test(ua)) return { kind: 'bot' };

  // Account deletion is gated by the session cookie and the confirm string.
  // The human cookie expires first; a shopper must still be able to delete.
  if (path === '/api/account/delete') return { kind: 'allow' };

  // Phone-wallet sign-in, session read and logout. The handlers authenticate
  // these. A Privy `{ token }` login is on this path too and is refused
  // again in the handler when the Turnstile cookie is missing.
  if (isNativeWalletSessionRoute(path, req.method)) return { kind: 'allow' };

  if (path.startsWith('/api/') && path !== '/api/human') {
    if (!hasBrowserFetchHints(req)) return { kind: 'humans', message: HUMANS_ONLY };
    const mode = humanGateMode(env);
    if (mode === 'closed') return { kind: 'humans', message: HUMANS_VERIFY };
    if (mode === 'enforce') {
      const secret = turnstileSecret(env);
      // Prefer the framework cookie jar. Fall back to the header so a quoted
      // or encoded value still counts. Both have to agree with requireHuman.
      const token = cookies?.get(HUMAN_COOKIE)?.value || readCookie(req.headers.get('cookie'), HUMAN_COOKIE);
      const ok = await verifyHumanToken(token, secret);
      if (!ok) return { kind: 'humans', message: HUMANS_VERIFY };
    }
  }
  return { kind: 'allow' };
}
