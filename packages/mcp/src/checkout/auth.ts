import { promises as fs } from 'node:fs';

import type { AppConfig } from '../config.js';
import { log } from '../secure/redact.js';
import { launch, newContext, persist, readProfile } from './browser.js';
import {
  type SessionHealth,
  isUsable,
  readSession,
  sessionExists,
  sessionHealth,
} from './session-store.js';

/**
 * Linking the user's supermarket account.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: we never see the password. A headed
 * browser is opened at the store's login page and then left alone — no `fill`,
 * no `type`, no reading of input values, no screenshots. The only thing this
 * code does while the user is signing in is ask the store, over the store's own
 * API, whether the session has become authenticated yet.
 *
 * That is also why the login cannot be automated even in principle here: there
 * is nowhere for a password to come from. If a future change adds one, it will
 * have to delete this comment first.
 */

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;

export interface LinkResult {
  linked: boolean;
  account?: string;
  firstName?: string;
  /** DNI, read from the user's own profile — never asked for in chat. */
  hasDocument: boolean;
  health: SessionHealth;
  message: string;
}

export interface LinkOptions {
  timeoutMs?: number;
  /** Injected in tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function linkAccount(
  cfg: AppConfig,
  passphrase: string,
  opts: LinkOptions = {},
): Promise<LinkResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // Always headed. A headless login box is a login box the user cannot type in.
  const browser = await launch(cfg, { headed: true });
  const context = await newContext(browser, cfg);
  try {
    const page = await context.newPage();
    await page.goto(`https://${cfg.host}/login?returnUrl=%2F`, { waitUntil: 'domcontentloaded' });

    log(`[auth] waiting for you to sign in at ${cfg.host} — this window is yours, I do not touch it.`);

    const deadline = now() + timeoutMs;
    let profile: Awaited<ReturnType<typeof readProfile>> | undefined;

    while (now() < deadline) {
      if (page.isClosed() && context.pages().length === 0) {
        throw new Error('The login window was closed before sign-in completed. Nothing was saved.');
      }
      // context.request, not page.request: the user may navigate anywhere
      // during login, including to a page that never finishes loading.
      profile = await readProfile(context.request, cfg).catch(() => undefined);
      if (profile?.authenticated) break;
      await sleep(POLL_MS);
    }

    if (!profile?.authenticated) {
      return {
        linked: false,
        hasDocument: false,
        health: sessionHealth(undefined),
        message:
          `No sign-in detected within ${Math.round(timeoutMs / 60_000)} minutes. Nothing was saved. ` +
          'Run link_marketplace_account again when you are ready.',
      };
    }

    const stored = await persist(context, cfg, passphrase, profile.email);
    const health = sessionHealth(stored, now());

    return {
      linked: true,
      account: profile.email,
      firstName: profile.firstName,
      hasDocument: Boolean(profile.document),
      health,
      message: buildLinkMessage(cfg, profile, health),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function buildLinkMessage(
  cfg: AppConfig,
  profile: { email?: string; firstName?: string; document?: string; documentType?: string },
  health: SessionHealth,
): string {
  const who = [profile.firstName, profile.email].filter(Boolean).join(' · ');
  const lines = [
    `Linked to ${cfg.retailer} as ${who || 'your account'}. ${health.message}`,
  ];
  if (profile.document) {
    // Said out loud without printing the number: the user asked us to use the
    // DNI already on their profile rather than collect it in chat.
    lines.push(
      `Your ${profile.documentType ?? 'DNI'} is already on the profile, so checkout will use it — ` +
        'I do not need you to type it.',
    );
  } else {
    lines.push(
      'Heads up: no DNI is on this profile. Día normally requires one at checkout, so the ' +
        'payment step may stop and ask for it.',
    );
  }
  lines.push('Your password was never seen by this process, and is not stored anywhere.');
  return lines.join('\n');
}

export interface StatusResult {
  linked: boolean;
  account?: string;
  health: SessionHealth;
  /** Only populated when `live` was requested and a browser was opened. */
  liveCheck?: { authenticated: boolean; account?: string };
  message: string;
}

/**
 * Cheap by default: reads the vault and reasons about cookie expiry without
 * opening a browser. `live: true` additionally asks the store, which costs a
 * browser launch but is the only way to catch a server-side logout.
 */
export async function sessionStatus(
  cfg: AppConfig,
  passphrase: string,
  opts: { live?: boolean } = {},
): Promise<StatusResult> {
  const stored = await readSession(cfg.sessionVaultPath, passphrase);
  const health = sessionHealth(stored);
  const base: StatusResult = {
    linked: Boolean(stored),
    account: stored?.meta.account,
    health,
    message: health.message,
  };

  if (!opts.live || !stored || !isUsable(health)) return base;

  const browser = await launch(cfg, {});
  const context = await newContext(browser, cfg, stored.state);
  try {
    const profile = await readProfile(context.request, cfg);
    return {
      ...base,
      liveCheck: { authenticated: profile.authenticated, account: profile.email },
      message: profile.authenticated
        ? `${health.message} Confirmed signed in as ${profile.email ?? 'your account'}.`
        : 'The cookies have not expired, but the store no longer recognises the session. Re-link before paying.',
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Deletes the saved session. The only way to "log out" from our side. */
export async function unlinkAccount(cfg: AppConfig): Promise<boolean> {
  if (!(await sessionExists(cfg.sessionVaultPath))) return false;
  await fs.rm(cfg.sessionVaultPath, { force: true });
  log(`[auth] removed ${cfg.sessionVaultPath}`);
  return true;
}
