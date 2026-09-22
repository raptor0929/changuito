/**
 * Cloudflare Turnstile verification for the waitlist form.
 *
 * Production refuses signups when keys are missing (same spirit as an
 * unconfigured sink). Local/dev with unset keys skips verification so
 * `next dev` still works — logged once per process.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const MISSING_TOKEN = 'Confirmá que no sos un robot.';
const VERIFY_FAILED = 'No pudimos verificar que no seas un robot. Probá de nuevo.';
const UNCONFIGURED = 'No pudimos anotarte. Probá de nuevo en un rato.';

export type TurnstileDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  ip?: string;
};

export type TurnstileResult = { ok: true } | { ok: false; error: string };

let loggedDevSkip = false;

export function turnstileKeys(env: NodeJS.ProcessEnv): { siteKey: string; secret: string } | undefined {
  const siteKey = (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
  const secret = (env.TURNSTILE_SECRET_KEY || '').trim();
  if (!siteKey || !secret) return undefined;
  return { siteKey, secret };
}

export async function verifyTurnstile(token: string, deps: TurnstileDeps): Promise<TurnstileResult> {
  const keys = turnstileKeys(deps.env);
  const isProd = deps.env.NODE_ENV === 'production';

  if (!keys) {
    if (isProd) {
      console.error(
        '[waitlist] Turnstile keys missing in production. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.',
      );
      return { ok: false, error: UNCONFIGURED };
    }
    if (!loggedDevSkip) {
      loggedDevSkip = true;
      console.warn('[waitlist] Turnstile keys unset — skipping CAPTCHA in non-production.');
    }
    return { ok: true };
  }

  const responseToken = token.trim();
  if (!responseToken) return { ok: false, error: MISSING_TOKEN };

  try {
    const body = new URLSearchParams();
    body.set('secret', keys.secret);
    body.set('response', responseToken);
    if (deps.ip && deps.ip !== 'unknown') body.set('remoteip', deps.ip);

    const response = await deps.fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`[waitlist] Turnstile siteverify status ${response.status}`);
      return { ok: false, error: VERIFY_FAILED };
    }
    const payload = (await response.json()) as { success?: boolean };
    if (payload.success === true) return { ok: true };
    return { ok: false, error: VERIFY_FAILED };
  } catch (error) {
    console.error('[waitlist] Turnstile verify failed', error instanceof Error ? error.message : 'unknown');
    return { ok: false, error: VERIFY_FAILED };
  }
}

/** Test helper — resets the one-shot dev skip log. */
export function resetTurnstileDevLog(): void {
  loggedDevSkip = false;
}
