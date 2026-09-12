import type { Frame, Locator, Page } from 'playwright';

import type { CardDetails } from '../pay/types.js';
import { log } from '../secure/redact.js';
import type { DeliveryAddress } from '../types.js';
import { duringPaymentWindow } from './browser.js';
import type { PageState } from './pagestate.js';
import {
  ADDRESS_FIELDS,
  BUTTONS,
  CARD_FIELDS,
  CREDIT_CARD_OPTION,
  type ButtonSpec,
  type FieldSpec,
  OTP_FIELD,
  looksLikeCardForm,
} from './selectors.js';

/**
 * Día-specific acting. Everything that must touch the DOM lives here; the
 * classifiers upstairs stay pure.
 *
 * The rule for this file: nothing it types is ever logged. `type` takes a value
 * and reports only which FIELD it filled. A log line saying
 * `filled pan` is useful; one saying what it filled would be the worst artifact
 * this project could produce.
 */

const SHORT_MS = 4_000;

/** Locator candidates for a field, best first. */
function candidates(root: Page | Frame, spec: FieldSpec): Locator[] {
  const out: Locator[] = [
    root.getByLabel(spec.label, { exact: false }),
    root.getByPlaceholder(spec.label),
    root.locator(`input[aria-label]`).filter({ hasText: spec.label }),
  ];
  for (const css of spec.css ?? []) out.push(root.locator(css));
  return out;
}

/** The first candidate that is actually on screen, or undefined. */
async function firstVisible(cands: Locator[], timeoutMs = SHORT_MS): Promise<Locator | undefined> {
  for (const c of cands) {
    try {
      const one = c.first();
      await one.waitFor({ state: 'visible', timeout: timeoutMs / cands.length });
      return one;
    } catch {
      // try the next link in the chain
    }
  }
  return undefined;
}

export async function findField(
  root: Page | Frame,
  spec: FieldSpec,
  timeoutMs = SHORT_MS,
): Promise<Locator | undefined> {
  return firstVisible(candidates(root, spec), timeoutMs);
}

export async function findButton(
  root: Page | Frame,
  spec: ButtonSpec,
  timeoutMs = SHORT_MS,
): Promise<Locator | undefined> {
  const byRole = root.getByRole('button', { name: spec.label });
  const count = await byRole.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const b = byRole.nth(i);
    const name = (await b.innerText().catch(() => '')) || '';
    if (spec.avoid?.test(name)) continue;
    if (await b.isVisible().catch(() => false)) return b;
  }
  const rest: Locator[] = [root.getByText(spec.label).first()];
  for (const css of spec.css ?? []) rest.push(root.locator(css));
  return firstVisible(rest, timeoutMs);
}

/**
 * Fill one field. Returns whether it was found. The VALUE never appears in a
 * log line, an error message or a return value.
 */
async function type(
  root: Page | Frame,
  spec: FieldSpec,
  value: string | undefined,
  timeoutMs = SHORT_MS,
): Promise<boolean> {
  if (!value) return false;
  const field = await findField(root, spec, timeoutMs);
  if (!field) {
    if (!spec.optional) log(`[dia] required field '${spec.id}' not found on this page`);
    return false;
  }
  await field.fill('');
  await field.type(value, { delay: 25 });
  log(`[dia] filled ${spec.id}`);
  return true;
}

// ---- address ---------------------------------------------------------------

export interface FillResult {
  filled: string[];
  missing: string[];
}

/**
 * Fill the delivery address form. Postal code goes in first and alone, because
 * VTEX reloads the shipping options around it — anything typed before it can be
 * wiped by that refresh.
 */
export async function fillAddress(page: Page, addr: DeliveryAddress): Promise<FillResult> {
  const filled: string[] = [];
  const missing: string[] = [];

  const put = async (spec: FieldSpec, value: string | undefined): Promise<void> => {
    if (!value) return;
    if (await type(page, spec, value)) filled.push(spec.id);
    else if (!spec.optional) missing.push(spec.id);
  };

  await put(ADDRESS_FIELDS.postalCode!, addr.postalCode);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  await put(ADDRESS_FIELDS.street!, addr.street);
  await put(ADDRESS_FIELDS.number!, addr.number);
  await put(ADDRESS_FIELDS.complement!, addr.complement);
  await put(ADDRESS_FIELDS.reference!, addr.reference);
  await put(ADDRESS_FIELDS.city!, addr.city);
  await put(ADDRESS_FIELDS.receiverName!, addr.receiverName);
  await put(ADDRESS_FIELDS.phone!, addr.phone);

  return { filled, missing };
}

// ---- payment ---------------------------------------------------------------

/**
 * Choose "tarjeta de crédito". Verified as the option that accepts an
 * international prepaid card; debit and the local wallets are explicitly
 * avoided by the selector rather than merely not chosen.
 */
export async function selectCreditCard(page: Page): Promise<boolean> {
  const option = await findButton(page, CREDIT_CARD_OPTION, 6_000);
  if (!option) {
    log('[dia] no "tarjeta de crédito" option found on the payment step');
    return false;
  }
  await option.click();
  await page.waitForTimeout(500);
  return true;
}

export interface CardFillResult extends FillResult {
  /** The document number typed into the cardholder-DNI field, if it asked. */
  usedDocument: boolean;
}

/**
 * Type the card.
 *
 * Wrapped in `duringPaymentWindow`, which hard-disables screenshots and tracing
 * for as long as it runs — a trace file containing a PAN is the one artifact
 * this project must never produce. The window closes even if this throws.
 */
export async function fillCard(
  page: Page,
  details: CardDetails,
  holderName: string,
  document?: string,
): Promise<CardFillResult> {
  return duringPaymentWindow(async () => {
    const filled: string[] = [];
    const missing: string[] = [];
    const put = async (spec: FieldSpec, value: string | undefined): Promise<boolean> => {
      const ok = await type(page, spec, value);
      if (ok) filled.push(spec.id);
      else if (!spec.optional) missing.push(spec.id);
      return ok;
    };

    await put(CARD_FIELDS.pan!, details.pan);
    await put(CARD_FIELDS.holder!, holderName);

    // Two shapes in the wild: one combined MM/AA box, or separate selects.
    const yy = details.expiry_year.slice(-2);
    const combined = await put(CARD_FIELDS.expiry!, `${details.expiry_month}/${yy}`);
    if (!combined) {
      await selectOrType(page, CARD_FIELDS.expiryMonth!, details.expiry_month);
      await selectOrType(page, CARD_FIELDS.expiryYear!, yy, details.expiry_year);
      const i = missing.indexOf('expiry');
      if (i >= 0) missing.splice(i, 1);
      filled.push('expiry');
    }

    await put(CARD_FIELDS.cvv!, details.cvv);
    const usedDocument = document ? await put(CARD_FIELDS.document!, document) : false;

    return { filled, missing, usedDocument };
  });
}

/** A select takes an option value; an input takes typing. Try both. */
async function selectOrType(
  page: Page,
  spec: FieldSpec,
  value: string,
  alternate?: string,
): Promise<boolean> {
  const el = await findField(page, spec);
  if (!el) return false;
  for (const v of [value, alternate].filter(Boolean) as string[]) {
    try {
      await el.selectOption(v);
      log(`[dia] selected ${spec.id}`);
      return true;
    } catch {
      // not a <select>, or no such option
    }
  }
  try {
    await el.fill('');
    await el.type(value, { delay: 25 });
    log(`[dia] filled ${spec.id}`);
    return true;
  } catch {
    return false;
  }
}

/** Press the button that spends the money. Called once, after approval. */
export async function submitPayment(page: Page): Promise<boolean> {
  const pay = await findButton(page, BUTTONS.pay!, 6_000);
  if (!pay) {
    log('[dia] the pay button is not on this page');
    return false;
  }
  await pay.click();
  return true;
}

// ---- 3DS -------------------------------------------------------------------

export type ThreeDsKind = 'inline_input' | 'iframe' | 'redirect' | 'none';

export interface ThreeDsTarget {
  kind: ThreeDsKind;
  /** The page or frame the OTP field lives in. */
  root?: Page | Frame;
}

/**
 * Where is the challenge? All three shapes are implemented; which one arrives
 * is a runtime fact, not a build-time assumption.
 */
export async function findThreeDs(page: Page, ps?: PageState): Promise<ThreeDsTarget> {
  if (await findField(page, OTP_FIELD, 1_500)) return { kind: 'inline_input', root: page };

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await findField(frame, OTP_FIELD, 1_500)) return { kind: 'iframe', root: frame };
  }

  // A bank-hosted page: we left the store entirely.
  const url = ps?.url ?? page.url();
  if (!/supermercadosdia\.com\.ar/i.test(url)) return { kind: 'redirect', root: page };

  return { kind: 'none' };
}

/**
 * Type the one-time code and submit it. The OTP is registered with the redactor
 * by the Vyrion client before it gets here, so even a thrown Playwright error
 * quoting the value comes out masked.
 */
export async function submitOtp(target: ThreeDsTarget, otp: string): Promise<boolean> {
  const root = target.root;
  if (!root || target.kind === 'none') return false;
  return duringPaymentWindow(async () => {
    if (!(await type(root, OTP_FIELD, otp, 6_000))) return false;
    const button = await findButton(root, BUTTONS.submitOtp!, 3_000);
    if (button) await button.click();
    else await root.locator(`input`).first().press('Enter').catch(() => undefined);
    return true;
  });
}

// ---- confirmation ----------------------------------------------------------

export interface OrderConfirmation {
  orderGroup?: string;
  orderNumber?: string;
  /** Where the user can see the order themselves. */
  statusUrl?: string;
}

/**
 * Read the order out of the confirmation screen. The orderGroup from the
 * orderForm is authoritative; the page is only a fallback for when the SPA has
 * already navigated away from the document we were reading.
 */
export function parseConfirmation(
  host: string,
  ps: PageState,
  orderGroup?: string,
): OrderConfirmation {
  const fromUrl = ps.url.match(/(?:og|orderGroup)=([A-Za-z0-9-]+)/)?.[1];
  const fromText = [...ps.headings, ...ps.dialogText, ps.title]
    .join(' ')
    .match(/\b(\d{6,}-?\d*)\b/)?.[1];

  const group = orderGroup ?? fromUrl;
  return {
    orderGroup: group,
    orderNumber: fromText ?? group,
    statusUrl: group ? `https://${host}/checkout/orderPlaced/?og=${group}` : undefined,
  };
}

/** True when the page in front of us is a card form. Used as a last check. */
export { looksLikeCardForm };
