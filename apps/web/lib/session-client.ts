/**
 * Mint the httpOnly `chg_user` cookie after Pollar login.
 *
 * WalletWidget and the chat retry share one in-flight POST so a turn that
 * races the cookie waits for the same response instead of firing a second one.
 */

let pending: { address: string; promise: Promise<boolean> } | null = null;
let readyAddress: string | null = null;
let generation = 0;

function start(address: string): Promise<boolean> {
  const gen = generation;
  const promise = fetch('/api/session/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ address }),
  })
    .then((res) => {
      if (!res.ok || gen !== generation) return false;
      readyAddress = address;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { address, promise };
  return promise;
}

/** Logout cleared the cookie. The next login has to mint a new one. */
export function forgetUserSession(): void {
  readyAddress = null;
  generation += 1;
}

/**
 * Resolve true once `chg_user` should be on this origin.
 * `force` remints when the server still answered `login_required`.
 */
export function ensureUserSession(address: string, opts?: { force?: boolean }): Promise<boolean> {
  const force = opts?.force === true;
  if (!force && readyAddress === address) return Promise.resolve(true);
  if (pending?.address === address) {
    if (!force) return pending.promise;
    return pending.promise.then((ok) => (ok ? true : start(address)));
  }
  if (force) readyAddress = null;
  return start(address);
}
