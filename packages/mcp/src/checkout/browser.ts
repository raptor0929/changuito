import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  chromium,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

import type { AppConfig } from '../config.js';
import { log, redactToString } from '../secure/redact.js';
import {
  type SessionHealth,
  type StorageState,
  type StoredSession,
  isUsable,
  parseAuthenticatedUser,
  profileFromOrderForm,
  readSession,
  saveSession,
  sessionHealth,
} from './session-store.js';

/**
 * Playwright ownership lives here and nowhere else: launching, the saved
 * session, and the artifact kill-switch.
 *
 * THE KILL-SWITCH. Playwright traces, videos and screenshots record the DOM,
 * and during the payment step the DOM contains a card number. A trace file with
 * a PAN in it would be the worst artifact this project could produce — it
 * outlives the process, it gets attached to bug reports, and nothing downstream
 * would redact it. So artifact capture is not "disabled by default"; it is
 * refused outright while a payment window is open.
 */

let paymentWindowDepth = 0;

export function inPaymentWindow(): boolean {
  return paymentWindowDepth > 0;
}

/**
 * Wrap the part of the flow where card data is on the page. Nested calls are
 * counted, so an inner window cannot re-enable capture for the outer one.
 */
export async function duringPaymentWindow<T>(fn: () => Promise<T>): Promise<T> {
  paymentWindowDepth++;
  try {
    return await fn();
  } finally {
    paymentWindowDepth--;
  }
}

export class ArtifactRefused extends Error {
  constructor() {
    super(
      'Refusing to capture a screenshot or trace while card data may be on the page. ' +
        'This is not configurable.',
    );
    this.name = 'ArtifactRefused';
  }
}

export interface LaunchOptions {
  headed?: boolean;
  slowMoMs?: number;
}

export async function launch(cfg: AppConfig, opts: LaunchOptions = {}): Promise<Browser> {
  const headless = opts.headed ? false : cfg.browser.headless;
  try {
    return await chromium.launch({
      headless,
      slowMo: opts.slowMoMs ?? cfg.browser.slowMoMs,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
      throw new Error(
        'Chromium is not installed for Playwright. Run:\n\n  npx playwright install chromium\n\n' +
          `(original error: ${msg.split('\n')[0]})`,
      );
    }
    throw e;
  }
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export async function newContext(
  browser: Browser,
  cfg: AppConfig,
  state?: StorageState,
): Promise<BrowserContext> {
  return browser.newContext({
    // Our StorageState mirrors Playwright's shape but types sameSite loosely,
    // since it round-trips through JSON in the vault.
    storageState: state as unknown as Awaited<ReturnType<BrowserContext['storageState']>>,
    userAgent: UA,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1280, height: 900 },
    // Explicitly off, everywhere, always. See the kill-switch note above.
    recordVideo: undefined,
    recordHar: undefined,
  });
}

export interface SessionRun {
  page: Page;
  context: BrowserContext;
  cfg: AppConfig;
  health: SessionHealth;
  /** The user's profile as the store sees it — name, email, DNI. */
  profile?: ReturnType<typeof profileFromOrderForm>;
}

export interface WithSessionOptions extends LaunchOptions {
  /** Refuse to run when the saved session is expired or missing. Default true. */
  requireAuth?: boolean;
  /** Persist any cookie refresh the store performed. Default true. */
  saveBack?: boolean;
}

/**
 * Open the user's saved session in a browser, run `fn`, and put the session
 * back. The session is re-saved on the way out because VTEX rotates its auth
 * cookie: dropping the rotation would expire the link early for no reason.
 */
export async function withSession<T>(
  cfg: AppConfig,
  passphrase: string,
  fn: (run: SessionRun) => Promise<T>,
  opts: WithSessionOptions = {},
): Promise<T> {
  const stored = await readSession(cfg.sessionVaultPath, passphrase);
  const health = sessionHealth(stored);

  if (opts.requireAuth !== false && !isUsable(health)) {
    throw new Error(health.message);
  }

  const browser = await launch(cfg, opts);
  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, cfg, stored?.state);
    const page = await context.newPage();
    await page.goto(`https://${cfg.host}/`, { waitUntil: 'domcontentloaded' });

    const profile = await readProfile(page.request, cfg);
    if (opts.requireAuth !== false && !profile.authenticated) {
      throw new Error(
        'The saved session is no longer signed in at the store, even though the cookies ' +
          'had not expired. Run link_marketplace_account and log in again.',
      );
    }

    const out = await fn({ page, context, cfg, health, profile });

    if (opts.saveBack !== false && stored) {
      await persist(context, cfg, passphrase, stored.meta.account ?? profile.email);
    }
    return out;
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function persist(
  context: BrowserContext,
  cfg: AppConfig,
  passphrase: string,
  account?: string,
): Promise<StoredSession> {
  const state = (await context.storageState()) as unknown as StorageState;
  const session: StoredSession = {
    meta: { savedAt: new Date().toISOString(), retailer: cfg.retailer, host: cfg.host, account },
    state,
  };
  await saveSession(cfg.sessionVaultPath, passphrase, session);
  return session;
}

/**
 * Calls the store's API *from inside the browser*, so it carries the user's
 * cookies. This is the mechanism the whole cart-building step rests on: the
 * same VTEX endpoints adapters/vtex.ts already speaks, executed as the
 * logged-in user rather than anonymously.
 */
export async function apiGet<T>(req: APIRequestContext, path: string): Promise<T | undefined> {
  const res = await req.get(path, { headers: { Accept: 'application/json' } });
  if (!res.ok()) return undefined;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function apiPost<T>(
  req: APIRequestContext,
  path: string,
  data: unknown,
): Promise<{ ok: boolean; status: number; body?: T; error?: string }> {
  const res = await req.post(path, {
    data: data as Record<string, unknown>,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  let body: T | undefined;
  let text = '';
  try {
    text = await res.text();
    body = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    /* non-JSON body; keep the text for the error path */
  }
  return res.ok()
    ? { ok: true, status: res.status(), body }
    : { ok: false, status: res.status(), body, error: redactToString(text).slice(0, 400) };
}

/**
 * Two independent answers to "is this session signed in", because they fail
 * differently: the VTEX ID endpoint is authoritative but occasionally 404s on
 * IO storefronts, and the orderForm always exists but can look half-populated.
 */
export async function readProfile(req: APIRequestContext, cfg: AppConfig) {
  const idUser = await apiGet<unknown>(req, `https://${cfg.host}/api/vtexid/pub/authenticated/user`);
  const fromId = parseAuthenticatedUser(idUser);

  const orderForm = await apiGet<unknown>(
    req,
    `https://${cfg.host}/api/checkout/pub/orderForm?sc=1`,
  );
  const fromOf = profileFromOrderForm(orderForm);

  return {
    ...fromOf,
    email: fromOf.email ?? fromId.email,
    authenticated: fromOf.authenticated || fromId.authenticated,
  };
}

/** Screenshot for the user, refused while card data could be on screen. */
export async function screenshot(page: Page, dir: string, name: string): Promise<string> {
  if (inPaymentWindow()) throw new ArtifactRefused();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${Date.now()}-${name.replace(/[^a-z0-9_-]/gi, '_')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`[browser] screenshot -> ${file}`);
  return file;
}

/** Tracing exists for debugging the navigation loop, never for the payment step. */
export async function startTrace(context: BrowserContext): Promise<void> {
  if (inPaymentWindow()) throw new ArtifactRefused();
  await context.tracing.start({ screenshots: true, snapshots: true });
}

export async function stopTrace(context: BrowserContext, path: string): Promise<void> {
  if (inPaymentWindow()) throw new ArtifactRefused();
  await context.tracing.stop({ path });
}
