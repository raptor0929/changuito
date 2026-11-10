/**
 * `fetch` for a request that belongs to one account: it makes sure the
 * session cookie is this wallet's first, says which wallet it means
 * (lib/wallet-header.ts), and when the server answers that the cookie is
 * someone else's, re-mints it and tries once more.
 *
 * Its relative imports name their extension, so it loads under
 * `node --experimental-strip-types`.
 */
import { ensureUserCookie, type TokenSource } from './session-login.ts';
import { SESSION_MISMATCH, WALLET_HEADER } from './wallet-header.ts';

export interface Who {
  address: string | null;
  sign: TokenSource;
}

export async function fetchAs(who: Who, url: string, init: RequestInit = {}): Promise<Response> {
  const go = () =>
    fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(who.address ? { [WALLET_HEADER]: who.address } : {}) },
    });
  if (who.address) await ensureUserCookie(who.address, who.sign);
  const res = await go();
  if (res.status !== 409 || !who.address) return res;
  const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
  if (body?.error !== SESSION_MISMATCH) return res;
  await ensureUserCookie(who.address, who.sign, { force: true });
  return go();
}
