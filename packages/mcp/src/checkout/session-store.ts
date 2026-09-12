import { readVault, vaultExists, writeVault } from '../secure/vault.js';

/**
 * The saved browser session: cookies and localStorage for the user's real
 * supermarket account. Everything in this file is deliberately free of
 * Playwright imports so the expiry logic can be unit-tested without a browser —
 * the part most likely to be wrong is the arithmetic, not the automation.
 *
 * Whoever holds this file is logged in as the user, so it never touches disk
 * unencrypted. See secure/vault.ts.
 */

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Epoch SECONDS, or -1 for a session cookie that dies with the browser. */
  expires: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface StorageState {
  cookies: StoredCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

export interface SessionMeta {
  /** ISO timestamp of the headed login. */
  savedAt: string;
  retailer: string;
  host: string;
  /** Shown back to the user so they can confirm it is the right account. */
  account?: string;
}

export interface StoredSession {
  meta: SessionMeta;
  state: StorageState;
}

/**
 * VTEX issues `VtexIdclientAutCookie` for the platform and
 * `VtexIdclientAutCookie_{account}` per store. Either one going stale logs the
 * user out, so the earliest expiry is what matters, not the latest.
 */
const AUTH_COOKIE = /^VtexIdclientAutCookie/i;

export function authCookies(state: StorageState | undefined): StoredCookie[] {
  return (state?.cookies ?? []).filter((c) => AUTH_COOKIE.test(c.name) && c.value);
}

export type SessionStatus = 'ok' | 'expiring_soon' | 'expired' | 'no_auth_cookie' | 'unknown_expiry';

export interface SessionHealth {
  status: SessionStatus;
  savedAt?: string;
  ageHours?: number;
  /** Epoch ms of the earliest auth-cookie expiry, when the cookies declare one. */
  expiresAt?: number;
  secondsLeft?: number;
  cookieCount: number;
  message: string;
}

/** Refuse to start a checkout that would expire mid-flow. */
export const EXPIRING_SOON_SEC = 15 * 60;

export function sessionHealth(session: StoredSession | undefined, nowMs = Date.now()): SessionHealth {
  if (!session) {
    return {
      status: 'no_auth_cookie',
      cookieCount: 0,
      message: 'No saved session. Run link_marketplace_account and log in yourself.',
    };
  }

  const savedAtMs = Date.parse(session.meta.savedAt);
  const ageHours = Number.isFinite(savedAtMs) ? (nowMs - savedAtMs) / 3_600_000 : undefined;
  const auth = authCookies(session.state);
  const common = {
    savedAt: session.meta.savedAt,
    ageHours: ageHours === undefined ? undefined : Math.round(ageHours * 10) / 10,
    cookieCount: auth.length,
  };

  if (auth.length === 0) {
    return {
      ...common,
      status: 'no_auth_cookie',
      message:
        'The saved session has no VTEX auth cookie in it. The login probably did not complete. ' +
        'Run link_marketplace_account again.',
    };
  }

  // -1 means "session cookie": no declared lifetime, dies with the browser it
  // came from. We keep it (it still authenticates when replayed) but we cannot
  // reason about when it dies, so we say so instead of guessing.
  const dated = auth.map((c) => c.expires).filter((e) => typeof e === 'number' && e > 0);
  if (dated.length === 0) {
    return {
      ...common,
      status: 'unknown_expiry',
      message:
        'The auth cookies are session cookies with no declared expiry. Validity will be ' +
        'checked against the store before anything is spent.',
    };
  }

  const expiresAt = Math.min(...dated) * 1000;
  const secondsLeft = Math.round((expiresAt - nowMs) / 1000);

  if (secondsLeft <= 0) {
    return {
      ...common,
      status: 'expired',
      expiresAt,
      secondsLeft,
      message: `The saved session expired ${describeSpan(-secondsLeft)} ago. Run link_marketplace_account again.`,
    };
  }
  if (secondsLeft <= EXPIRING_SOON_SEC) {
    return {
      ...common,
      status: 'expiring_soon',
      expiresAt,
      secondsLeft,
      message:
        `The saved session expires in ${describeSpan(secondsLeft)} — less than a checkout takes. ` +
        'Re-link before paying rather than risk losing the cart mid-flow.',
    };
  }
  return {
    ...common,
    status: 'ok',
    expiresAt,
    secondsLeft,
    message: `Session valid for another ${describeSpan(secondsLeft)}.`,
  };
}

/** Whether the flow may proceed to spend money on this session. */
export function isUsable(health: SessionHealth): boolean {
  return health.status === 'ok' || health.status === 'unknown_expiry';
}

export function describeSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = s / 3600;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${Math.round(h / 24)} days`;
}

/**
 * VTEX's own answer to "is this session logged in". Returns the parsed verdict
 * rather than a boolean so the caller can show the user *which* account is
 * linked — the wrong-account case is otherwise silent and expensive.
 */
export function parseAuthenticatedUser(body: unknown): { authenticated: boolean; email?: string; userId?: string } {
  if (!body || typeof body !== 'object') return { authenticated: false };
  const b = body as Record<string, unknown>;
  const user = (b.user ?? b.User ?? b.email ?? b.Email) as unknown;
  const email = typeof user === 'string' ? user : undefined;
  const userId = typeof b.userId === 'string' ? b.userId : typeof b.id === 'string' ? b.id : undefined;
  return { authenticated: Boolean(email || userId), email, userId };
}

/** The same question answered from an orderForm, which we fetch anyway. */
export function profileFromOrderForm(orderForm: unknown): {
  authenticated: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** DNI. Present because Día requires it at account creation. */
  document?: string;
  documentType?: string;
  phone?: string;
} {
  const p = (orderForm as { clientProfileData?: Record<string, unknown> } | undefined)?.clientProfileData;
  if (!p) return { authenticated: false };
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  const email = s('email');
  return {
    // An anonymous orderForm can still carry an email if one was typed in, so
    // require the pieces that only a real profile has.
    authenticated: Boolean(email && (s('firstName') || s('document'))),
    email,
    firstName: s('firstName'),
    lastName: s('lastName'),
    document: s('document'),
    documentType: s('documentType'),
    phone: s('phone'),
  };
}

export async function saveSession(path: string, passphrase: string, session: StoredSession): Promise<void> {
  await writeVault(path, session, passphrase);
}

export async function readSession(path: string, passphrase: string): Promise<StoredSession | undefined> {
  if (!(await vaultExists(path))) return undefined;
  return readVault<StoredSession>(path, passphrase);
}

export { vaultExists as sessionExists };
