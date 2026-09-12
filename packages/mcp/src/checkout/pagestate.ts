import type { Frame, Page } from 'playwright';

import { redact } from '../secure/redact.js';

/**
 * A compact, structural description of whatever is on screen.
 *
 * Two rules shape this file:
 *
 *  1. STRUCTURE, NEVER VALUES. Field labels, button names, headings, error
 *     text — never the contents of an input. The extract is what gets sent to
 *     Jev, and a card number in a field we happened to have filled must not be
 *     able to leave the process. There is no `.value` read anywhere below.
 *  2. Every classifier above Layer 1 works on this object rather than on the
 *     Page, so classification stays pure and testable and only *acting* needs
 *     a browser.
 */

export interface PageState {
  url: string;
  /** The part after '#', which is what the VTEX SPA routes on. */
  hash: string;
  title: string;
  headings: string[];
  /** Accessible names of clickable things, in DOM order. */
  buttons: string[];
  links: string[];
  /** Labels/placeholders of inputs — what the page is ASKING for. */
  fields: Array<{ label: string; type: string; required: boolean; filled: boolean }>;
  /** Anything that looks like an error or alert. */
  errors: string[];
  /** Text inside a dialog/modal, if one is open. */
  dialogText: string[];
  /** Money-shaped strings found on the page, for corroborating the total. */
  amounts: string[];
  /** src of every iframe — 3DS challenges usually arrive in one. */
  frames: string[];
  /** Length of the visible text, a cheap "did the page change" signal. */
  textLength: number;
}

/**
 * Runs in the page. Deliberately DOM-only: no framework internals, nothing
 * store-specific, and — see rule 1 — no input values.
 */
/* c8 ignore start — executed in the browser, covered by fixture tests instead */
function extract(): Omit<PageState, 'frames'> {
  const vis = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r) return false;
    const s = getComputedStyle(el as HTMLElement);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const txt = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const take = <T>(a: T[]): T[] => a.slice(0, 40);
  const uniq = (a: string[]): string[] => [...new Set(a.filter(Boolean))];

  const nameOf = (el: Element): string =>
    clean_(
      el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby')
          ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent
          : '') ||
        txt(el) ||
        (el as HTMLInputElement).placeholder ||
        el.getAttribute('title') ||
        '',
    );
  function clean_(s: string | null | undefined): string {
    return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  const labelFor = (el: Element): string => {
    const id = el.getAttribute('id');
    const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapping = el.closest('label');
    return clean_(
      el.getAttribute('aria-label') ||
        byFor?.textContent ||
        wrapping?.textContent ||
        (el as HTMLInputElement).placeholder ||
        el.getAttribute('name') ||
        '',
    );
  };

  const clickables = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')].filter(vis);
  const anchors = [...document.querySelectorAll('a[href]')].filter(vis);
  const inputs = [...document.querySelectorAll('input, select, textarea')].filter(vis) as HTMLInputElement[];
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], .vtex-modal, [class*="modal"][class*="open"]')].filter(vis);
  const alerts = [...document.querySelectorAll('[role="alert"], [class*="error"], [class*="Error"], [class*="alert"]')].filter(vis);

  const body = document.body?.innerText ?? '';

  return {
    url: location.href,
    hash: location.hash.replace(/^#/, ''),
    title: clean_(document.title),
    headings: take(uniq([...document.querySelectorAll('h1, h2, h3, [role="heading"]')].filter(vis).map(txt))),
    buttons: take(uniq(clickables.map(nameOf))),
    links: take(uniq(anchors.map(nameOf))).slice(0, 20),
    fields: take(
      inputs
        .filter((i) => i.type !== 'hidden')
        .map((i) => ({
          label: labelFor(i),
          type: i.type || i.tagName.toLowerCase(),
          required: i.required || i.getAttribute('aria-required') === 'true',
          // Whether it has content — never WHAT the content is.
          filled: Boolean((i.value ?? '').length),
        })),
    ),
    errors: take(uniq(alerts.map(txt).filter((t) => t.length > 1))),
    dialogText: take(uniq(dialogs.map(txt))),
    amounts: take(uniq(body.match(/\$\s?[\d.]+,\d{2}/g) ?? [])),
    textLength: body.length,
  };
}
/* c8 ignore stop */

export async function readPageState(page: Page): Promise<PageState> {
  const base = await page.evaluate(extract);
  const frames = page
    .frames()
    .map((f: Frame) => f.url())
    .filter((u) => u && u !== 'about:blank' && u !== page.url())
    .slice(0, 10);

  // Redacted on the way out: this object is logged, shown to the user, and —
  // when Jev is enabled — sent to a third party.
  return redact({ ...base, frames });
}

// ---- pure helpers, used by the classifier layers -------------------------

export function allText(ps: PageState): string {
  return [
    ps.title,
    ...ps.headings,
    ...ps.buttons,
    ...ps.links,
    ...ps.dialogText,
    ...ps.errors,
    ...ps.fields.map((f) => f.label),
  ].join(' \n ');
}

export function hasText(ps: PageState, re: RegExp): boolean {
  return re.test(allText(ps));
}

/** The accessible name of a button matching `re`, or undefined. */
export function findButton(ps: PageState, re: RegExp): string | undefined {
  return ps.buttons.find((b) => re.test(b));
}

export function hasField(ps: PageState, re: RegExp): boolean {
  return ps.fields.some((f) => re.test(f.label));
}

/**
 * Cheap identity for stall detection: two observations with the same signature
 * mean the page did not change, whatever the classifier decided.
 */
export function signature(ps: PageState): string {
  return [
    ps.url,
    ps.headings.join('|'),
    ps.buttons.join('|'),
    ps.fields.map((f) => `${f.label}:${f.filled ? 1 : 0}`).join('|'),
    ps.errors.join('|'),
    // Bucketed so a ticking countdown or a lazy image does not read as progress.
    Math.round(ps.textLength / 200),
  ].join('~');
}

/** A short, human-readable summary for escalations and logs. */
export function summarize(ps: PageState): string {
  const parts = [`URL: ${ps.url}`];
  if (ps.title) parts.push(`Title: ${ps.title}`);
  if (ps.headings.length) parts.push(`Headings: ${ps.headings.slice(0, 5).join(' / ')}`);
  if (ps.dialogText.length) parts.push(`Dialog: ${ps.dialogText[0]}`);
  if (ps.errors.length) parts.push(`Errors: ${ps.errors.slice(0, 3).join(' / ')}`);
  if (ps.fields.length) {
    parts.push(`Asks for: ${ps.fields.slice(0, 8).map((f) => f.label || f.type).join(', ')}`);
  }
  if (ps.buttons.length) parts.push(`Buttons: ${ps.buttons.slice(0, 8).join(', ')}`);
  if (ps.amounts.length) parts.push(`Amounts: ${ps.amounts.slice(0, 5).join(', ')}`);
  if (ps.frames.length) parts.push(`Frames: ${ps.frames.length}`);
  return parts.join('\n');
}

/** Used only in tests and fixtures. */
export function emptyPageState(over: Partial<PageState> = {}): PageState {
  return {
    url: 'https://example.test/',
    hash: '',
    title: '',
    headings: [],
    buttons: [],
    links: [],
    fields: [],
    errors: [],
    dialogText: [],
    amounts: [],
    frames: [],
    textLength: 0,
    ...over,
  };
}
