import { fileURLToPath } from 'node:url';

import type { AppConfig } from './config.js';

/**
 * The first-run surface.
 *
 * A user of this server does not have the repository open. They registered a
 * command in an MCP client and started talking. So "see SETUP.md" is useless to
 * them unless we say *where* SETUP.md is, and a tool surface of twenty
 * functions is useless to the model unless something says which order they go
 * in. Both of those are what this file is for.
 *
 * Everything here is pure and string-shaped so it can be asserted on.
 */

/** Absolute path to the setup guide, wherever this happens to be installed. */
export function setupGuidePath(): string {
  return fileURLToPath(new URL('../SETUP.md', import.meta.url));
}

/** A pointer a person can actually follow, unlike a bare filename. */
export function setupRef(section: string): string {
  return `See ${setupGuidePath()} — "${section}".`;
}

/**
 * Sent to the MCP client at connect time and shown to the model once per
 * session, so it pays for itself only if it is short. It covers what the tool
 * descriptions cannot: the order, and the two rules that must not be broken.
 */
export const SERVER_INSTRUCTIONS = `
Search Argentine supermarkets, build a cart in the user's own account, and pay for it
with a single-use virtual card funded from crypto.

TWO HALVES.
  Read-only (works immediately, no setup): set_location → search_products →
  price_check → add_to_cart → get_cart_link. This ends at a link the user opens.
  Checkout (needs setup, Día only): the ordered flow below.

THE CHECKOUT FLOW IS ORDERED. Each tool refuses until the one before it has run,
and names what is missing:
  link_marketplace_account → set_delivery_address → build_cart → review_order →
  check_funds → approve_payment

START WITH diagnose. On a fresh install it prints what is still missing and the
next concrete step. If a tool reports a configuration problem, run diagnose rather
than guessing.

TWO RULES THAT ARE NOT NEGOTIABLE.
  1. Never ask the user for their supermarket password, and never offer to type it.
     link_marketplace_account opens a real browser window and they type it there.
     This server never sees it.
  2. Never ask the user for their name or DNI. Both are already on their store
     profile and are read from it. Asking for them is a bug, not a courtesy.

SPENDING. approve_payment and replenish_wallet each require the user to restate the
exact amount, and both refuse unless ALLOW_LIVE is set. Relay what they return; do
not paraphrase an amount. If a tool escalates with a question, put it to the user —
that is the designed behaviour, not a failure.
`.trim();

export interface SetupStep {
  n: number;
  label: string;
  done: boolean;
  /** What to do when it is not done. Absent once it is. */
  next?: string;
}

export interface ReadinessInput {
  cfg: AppConfig;
  sessionExists: boolean;
  sessionPassphraseSet: boolean;
}

/**
 * What is configured, what is not, and the single next thing to do about it.
 *
 * Ordered by dependency, so the first incomplete step is always the right one to
 * show. Steps 1–2 are enough to buy groceries; 3 is only for topping the wallet
 * up from an EOA, which is why it is last despite being the fiddliest.
 */
export function readiness(input: ReadinessInput): SetupStep[] {
  const { cfg, sessionExists, sessionPassphraseSet } = input;
  const guide = setupGuidePath();

  return [
    {
      n: 1,
      label: 'Store account linked',
      done: sessionExists,
      next: sessionPassphraseSet
        ? 'Run link_marketplace_account. A browser window opens and you log in yourself.'
        : `Set SESSION_PASSPHRASE (8+ characters) in your MCP client's env block, restart it, then run link_marketplace_account. ${guide} — "Linking your Día account".`,
    },
    {
      n: 2,
      label: 'Card issuer configured',
      done: Boolean(cfg.vyrion.apiKey),
      next: `Set VYRION_API_KEY. Start with a sandbox key (sk_test_…). ${guide} — "Vyrion".`,
    },
    {
      n: 3,
      label: 'Wallet top-ups available (optional)',
      done: Boolean(cfg.wallet.rpcUrl),
      next: `Only needed for replenish_wallet. Set RPC_URL and create a keystore with \`npm run keystore -- --new\`. ${guide} — "Crypto wallet".`,
    },
    {
      n: 4,
      label: 'Live spending enabled',
      done: cfg.allowLiveRun,
      next: 'Deliberately off. Everything works in rehearsal without it; set ALLOW_LIVE=1 only when you intend to spend real money.',
    },
  ];
}

/** Whether the user can complete a purchase right now. Step 3 is not required. */
export const canPurchase = (steps: SetupStep[]): boolean =>
  steps.filter((s) => s.n <= 2).every((s) => s.done);

export function renderReadiness(steps: SetupStep[]): string {
  const lines = steps.map((s) => `  ${s.done ? '✓' : '·'} ${s.n}. ${s.label}`);
  const pending = steps.filter((s) => !s.done);

  const out = ['Setup', ...lines, ''];

  if (!pending.length) {
    out.push('Everything is configured. Start with set_location, then search_products.');
    return out.join('\n');
  }

  const first = pending[0]!;
  out.push(`NEXT — ${first.label.toLowerCase()}:`, `  ${first.next}`);

  if (canPurchase(steps)) {
    out.push('', 'Nothing above blocks a purchase; the remaining items are optional.');
  } else {
    out.push(
      '',
      'Search and price comparison work right now regardless — set_location, then search_products.',
    );
  }
  return out.join('\n');
}
