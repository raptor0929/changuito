import type { AppConfig } from '../../config.js';
import { log, redact } from '../../secure/redact.js';
import { type PageState, summarize } from '../pagestate.js';
import type { CheckoutState, Verdict } from '../types.js';

/**
 * LAYER 3 — Jev (TypeSafe), for screens Layers 1 and 2 could not name.
 *
 * Jev is not a browser and does not act. It answers a map of questions about a
 * state in one round trip, each answer carrying its own confidence. That is a
 * good fit for "what is this screen?" and a bad fit for everything else in this
 * codebase, so its remit is deliberately narrow.
 *
 * THREE RULES, enforced here rather than by convention:
 *
 *   1. FAIL CLOSED. Below `minConfidence`, or on any network or shape error,
 *      this returns undefined. The caller escalates to the user. It never
 *      guesses and never retries blindly.
 *   2. NEVER AN AUTHORITY ON AN AMOUNT. There is no question here that returns
 *      a number we would spend. `vetoPaymentScreen` can only say "stop"; the
 *      total is compared numerically against the orderForm elsewhere.
 *   3. NEVER SEES CARD DATA. The payload is a PageState, which by construction
 *      holds labels and never values, and it is passed through the redactor
 *      again on the way out.
 */

export interface JevQuestion {
  type: 'noul' | 'choice' | 'score';
  instructions?: string;
  criteria?: Record<string, string>;
}

export interface JevAnswer {
  noul?: string;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface JevResponse {
  answers?: Record<string, JevAnswer>;
  usage?: unknown;
}

export interface AskOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const TIMEOUT_MS = 15_000;

/** The states Jev is allowed to name, with the wording it is judged against. */
const PAGE_CRITERIA: Record<string, string> = {
  address_confirm: 'asking the shopper to confirm or correct a delivery address',
  shipping_slot: 'choosing a delivery day, time window or pickup option',
  payment_form: 'entering card or payment details',
  threeds: 'a bank one-time-code or 3-D Secure authentication challenge',
  interstitial: 'a dismissible popup: cookies, newsletter, or suggested extra products',
  cart_changed: 'telling the shopper an item is unavailable or a price changed',
  declined: 'telling the shopper the payment was refused',
  session_expired: 'asking the shopper to sign in again',
  confirmation: 'confirming the order was placed successfully',
  cart: 'a shopping cart listing items, before checkout begins',
  unknown: 'none of the above',
};

const ALLOWED = new Set<string>(Object.keys(PAGE_CRITERIA));

export async function ask(
  cfg: AppConfig,
  state: unknown,
  questions: Record<string, JevQuestion>,
  opts: AskOptions = {},
): Promise<Record<string, JevAnswer>> {
  if (!cfg.jev.enabled || !cfg.jev.apiKey) throw new Error('Jev is disabled.');

  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await doFetch(cfg.jev.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.jev.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // Redacted again on the way out. Belt and braces: the PageState should
      // already be clean, and this is the last point before it leaves.
      body: JSON.stringify(redact({ state, model: 'jev-latest', questions })),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Jev returned HTTP ${res.status}`);
    const body = (await res.json()) as JevResponse;
    if (!body?.answers) throw new Error('Jev returned no answers');
    return body.answers;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "What screen is this?" Returns undefined — never a guess — when Jev is off,
 * unreachable, unsure, or answers with something outside the allowed set.
 */
export async function classifyWithJev(
  cfg: AppConfig,
  ps: PageState,
  opts: AskOptions = {},
): Promise<Verdict | undefined> {
  if (!cfg.jev.enabled) return undefined;

  let answers: Record<string, JevAnswer>;
  try {
    answers = await ask(
      cfg,
      compactState(ps),
      {
        page: {
          type: 'choice',
          instructions:
            'This is a structural extract of a page in an Argentine supermarket checkout. ' +
            'Which of these best describes it?',
          criteria: PAGE_CRITERIA,
        },
        threeds_kind: {
          type: 'choice',
          instructions: 'If this is a bank authentication challenge, how is it presented?',
          criteria: {
            inline_input: 'the code field is on this page itself',
            iframe: 'the challenge is inside an embedded frame',
            redirect: 'the browser navigated to a bank-hosted page',
            none: 'this is not an authentication challenge',
          },
        },
      },
      opts,
    );
  } catch (e) {
    // Fail closed. The caller escalates; we do not retry into a money path.
    log(`[jev] unavailable, falling through to escalation: ${(e as Error).message}`);
    return undefined;
  }

  const page = answers.page;
  const choice = page?.choice;
  const confidence = page?.confidence ?? 0;

  if (!choice || !ALLOWED.has(choice)) {
    log(`[jev] answered with an unrecognised state "${choice}" — ignoring`);
    return undefined;
  }
  if (confidence < cfg.jev.minConfidence) {
    log(`[jev] confidence ${confidence} below ${cfg.jev.minConfidence} — ignoring`);
    return undefined;
  }
  if (choice === 'unknown') return undefined;

  const kind = answers.threeds_kind?.choice;
  return {
    state: choice as CheckoutState,
    confidence,
    layer: 'jev',
    why: `Jev classified this screen as ${choice} (confidence ${confidence.toFixed(2)})`,
    ...(choice === 'threeds' && kind && kind !== 'none'
      ? { threeDsKind: kind as Verdict['threeDsKind'] }
      : {}),
  };
}

/**
 * A veto, and only a veto. Asked immediately before submitting a payment: does
 * this page look like the checkout of the expected store, with nothing on it
 * suggesting something has gone wrong?
 *
 * A "yes" grants nothing — the numeric total check is what authorises the
 * payment. A "no", or an unsure answer, stops it.
 */
export async function vetoPaymentScreen(
  cfg: AppConfig,
  ps: PageState,
  opts: AskOptions = {},
): Promise<{ safe: boolean; why: string }> {
  if (!cfg.jev.enabled) return { safe: true, why: 'Jev disabled; deterministic checks only' };

  try {
    const answers = await ask(
      cfg,
      compactState(ps),
      {
        safe_to_pay: {
          type: 'choice',
          instructions:
            'A shopper is about to submit card details on this page. Is there anything on it ' +
            'suggesting this is NOT the normal payment step of the supermarket checkout — ' +
            'an error, a warning, a different site, a request for unexpected information?',
          criteria: {
            looks_normal: 'an ordinary payment step with no warnings',
            something_wrong: 'an error, warning, or anything unexpected is present',
          },
        },
      },
      opts,
    );
    const a = answers.safe_to_pay;
    const confidence = a?.confidence ?? 0;
    if (a?.choice === 'something_wrong' && confidence >= cfg.jev.minConfidence) {
      return { safe: false, why: `Jev flagged the payment screen (confidence ${confidence.toFixed(2)})` };
    }
    if (a?.choice !== 'looks_normal' || confidence < cfg.jev.minConfidence) {
      return { safe: false, why: `Jev could not vouch for the payment screen (confidence ${confidence.toFixed(2)})` };
    }
    return { safe: true, why: 'Jev saw nothing unexpected' };
  } catch (e) {
    // Fail closed here too: an unreachable classifier is not an approval.
    return { safe: false, why: `Jev was unreachable before payment: ${(e as Error).message}` };
  }
}

/**
 * What actually goes over the wire. Smaller than the full PageState, and with
 * the fields reduced to labels — there is no route by which a value reaches
 * this payload.
 */
export function compactState(ps: PageState): Record<string, unknown> {
  return {
    url: stripQuery(ps.url),
    hash: ps.hash,
    title: ps.title,
    headings: ps.headings.slice(0, 10),
    buttons: ps.buttons.slice(0, 15),
    asks_for: ps.fields.slice(0, 15).map((f) => `${f.label} (${f.type}${f.required ? ', required' : ''})`),
    errors: ps.errors.slice(0, 5),
    dialog: ps.dialogText.slice(0, 3),
    has_frames: ps.frames.length > 0,
    // summarize() prints the URL, so it gets the stripped one too — otherwise
    // the cart id leaves the process through the back door.
    summary: summarize({ ...ps, url: stripQuery(ps.url) }).slice(0, 1200),
  };
}

/** Query strings on a checkout URL can carry order and session identifiers. */
function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}
