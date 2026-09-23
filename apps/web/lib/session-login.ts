/**
 * Mint the httpOnly `chg_user` cookie that lifts the guest turn limit.
 *
 * Two callers now race the same Pollar login: the balance widget, which wants
 * the cookie to exist, and the chat, which has to *know* it exists before it
 * re-sends the message the gate rejected — otherwise the retry POSTs into the
 * same 401 it is recovering from. So the mint is awaitable, and de-duplicated
 * by address so the second caller waits on the first request instead of
 * firing another.
 *
 * No relative imports on purpose: that keeps the module loadable under
 * `node --experimental-strip-types`, which cannot resolve extensionless ones.
 */

let pending: { address: string; done: Promise<boolean> } | null = null;

/** Resolves true when the server has the cookie. Never rejects. */
export function ensureUserCookie(address: string): Promise<boolean> {
  if (pending?.address === address) return pending.done;

  const done = fetch('/api/session/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ address }),
  })
    .then((r) => r.ok)
    .catch(() => false)
    .then((ok) => {
      // Cache a success: the route is idempotent and the cookie is a 30-day
      // mint. Drop a failure, so the next caller gets a real attempt rather
      // than a remembered no.
      if (!ok && pending?.address === address) pending = null;
      return ok;
    });

  pending = { address, done };
  return done;
}

/**
 * After logout. The cookie a cached success stands for has just been cleared,
 * so logging back in with the same address has to mint it again.
 */
export function forgetUserCookie(): void {
  pending = null;
}
