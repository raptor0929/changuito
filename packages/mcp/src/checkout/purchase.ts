import { payableTotal, totalizerBreakdown, type VtexOrderForm } from '../adapters/orderform.js';
import type { AppConfig } from '../config.js';
import type { EphemeralCard } from '../pay/ephemeral-card.js';
import { formatUsd } from '../pay/vyrion.js';
import { log } from '../secure/redact.js';
import type { Centavos, DeliveryAddress } from '../types.js';
import { formatARS } from '../util/money.js';
import type { SessionRun } from './browser.js';
import { handoffUrl } from './cart.js';
import { buildEscalation } from './classify/escalate.js';
import { vetoPaymentScreen } from './classify/jev.js';
import { parseConfirmation, type OrderConfirmation } from './dia.js';
import { LiveDriver } from './driver.js';
import { type FlowResult, runFlow } from './flow.js';
import { summarize } from './pagestate.js';
import { Escalation } from './types.js';

/**
 * The two halves of a purchase, kept apart on purpose.
 *
 *   `driveToPayment` — everything that can be done without a card. Safe to run
 *   as often as you like, and it is what a dry run runs.
 *
 *   `payAndConfirm`  — everything that spends money. It refuses to start unless
 *   the total in front of it is, to the centavo, the total the user approved.
 *
 * Nothing here decides an amount. The total comes from the orderForm, the
 * funding from `decideFunding`, and the approval from the user restating the
 * figure. This file only refuses when they disagree.
 */

export interface ReviewResult {
  flow: FlowResult;
  orderForm?: VtexOrderForm;
  /** Items + shipping: the number that will be charged. */
  totalCentavos: Centavos;
  breakdown: Array<{ id: string; name: string; centavos: number }>;
  /** Where the user can open this exact cart in their own browser. */
  cartUrl: string;
  summary: string;
}

export interface DriveOptions {
  orderFormId?: string;
  address?: DeliveryAddress;
  maxSteps?: number;
  maxMs?: number;
}

/**
 * Drive the user's real, logged-in checkout as far as the payment form and
 * stop. No card is created, nothing is submitted.
 */
export async function driveToPayment(
  run: SessionRun,
  cfg: AppConfig,
  opts: DriveOptions = {},
): Promise<ReviewResult> {
  const { page } = run;
  const orderFormId = opts.orderFormId;

  if (orderFormId) {
    await page.goto(handoffUrl(cfg, orderFormId), { waitUntil: 'domcontentloaded' });
  } else if (!/\/checkout/.test(page.url())) {
    await page.goto(`https://${cfg.host}/checkout/#/cart`, { waitUntil: 'domcontentloaded' });
  }

  const driver = new LiveDriver({ page, cfg, orderFormId, address: opts.address });
  const flow = await runFlow(driver, {
    goal: 'payment_form',
    maxSteps: opts.maxSteps ?? cfg.browser.maxSteps,
    maxMs: opts.maxMs ?? cfg.browser.maxMs,
    hasAddress: Boolean(opts.address),
  });

  const of = flow.orderForm;
  const total = of ? payableTotal(of) : 0;
  const cartUrl = handoffUrl(cfg, of?.orderFormId ?? orderFormId ?? '');

  return {
    flow,
    orderForm: of,
    totalCentavos: total,
    breakdown: of ? totalizerBreakdown(of) : [],
    cartUrl,
    summary: describeReview(flow, total, cartUrl),
  };
}

function describeReview(flow: FlowResult, total: Centavos, cartUrl: string): string {
  const lines = [
    flow.reached
      ? `Reached the payment step in ${flow.steps} step(s).`
      : `Stopped at '${flow.verdict.state}': ${flow.verdict.why}`,
    `Total to pay: ${formatARS(total)}`,
    `Open this cart yourself: ${cartUrl}`,
  ];
  if (flow.verdict.problems?.length) {
    lines.push('', 'The store flagged:', ...flow.verdict.problems.map((p) => `  - ${p}`));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

export interface PayOptions {
  /** The exact ARS total the user approved, in centavos. */
  approvedTotalCentavos: Centavos;
  card: EphemeralCard;
  /** Cardholder name, read from the user's own store profile. */
  holderName: string;
  /** DNI, if the form asks for one. Also from their profile. */
  document?: string;
  orderFormId?: string;
  address?: DeliveryAddress;
  maxSteps?: number;
  maxMs?: number;
}

export interface PurchaseResult {
  placed: boolean;
  confirmation?: OrderConfirmation;
  totalCentavos: Centavos;
  flow: FlowResult;
  summary: string;
}

/**
 * Pay. Assumes the page is already on the payment step — `driveToPayment` put
 * it there and the user approved what it showed.
 *
 * The card is never terminated here: the caller owns its lifetime and must
 * terminate it in a `finally`, because a thrown escalation mid-payment is
 * exactly when an un-terminated card is most expensive.
 */
export async function payAndConfirm(
  run: SessionRun,
  cfg: AppConfig,
  opts: PayOptions,
): Promise<PurchaseResult> {
  const { page } = run;
  const driver = new LiveDriver({
    page,
    cfg,
    orderFormId: opts.orderFormId,
    address: opts.address,
    payment: {
      holderName: opts.holderName,
      document: opts.document,
      cardDetails: () => opts.card.cardDetails(),
      otp: () => opts.card.otp(),
    },
  });

  // GATE 1 — the amount. Re-read from the document, compared with ===, right
  // before anything is typed. Prices and stock drift mid-checkout; charging a
  // number the user did not approve is the failure this whole file exists to
  // prevent.
  const before = await driver.observe();
  const liveTotal = before.orderForm ? payableTotal(before.orderForm) : -1;
  if (liveTotal !== opts.approvedTotalCentavos) {
    throw buildEscalation(
      undefined,
      before.pageState,
      'total_mismatch',
      `You approved ${formatARS(opts.approvedTotalCentavos)}. The store now says ` +
        `${liveTotal < 0 ? 'it cannot tell me the total' : formatARS(liveTotal)}. ` +
        `Nothing was entered and the card was not used.`,
    );
  }

  // GATE 2 — Jev's veto. It can only ever say stop; it is never asked whether
  // an amount is right, and when it is disabled this is a no-op.
  const veto = await vetoPaymentScreen(cfg, before.pageState);
  if (!veto.safe) {
    throw buildEscalation(undefined, before.pageState, 'vetoed', veto.why);
  }

  log(`[purchase] paying ${formatARS(liveTotal)} with ••••${opts.card.last4} (${formatUsd(opts.card.fundedCents)} loaded)`);

  const flow = await runFlow(driver, {
    goal: 'confirmation',
    maxSteps: opts.maxSteps ?? cfg.browser.maxSteps,
    maxMs: opts.maxMs ?? cfg.browser.maxMs,
    hasAddress: Boolean(opts.address),
  });

  const after = flow.orderForm;
  const confirmation = flow.reached
    ? parseConfirmation(cfg.host, flow.pageState, after?.orderGroup)
    : undefined;

  return {
    placed: flow.reached,
    confirmation,
    totalCentavos: liveTotal,
    flow,
    summary: describePurchase(flow, liveTotal, confirmation),
  };
}

function describePurchase(
  flow: FlowResult,
  total: Centavos,
  confirmation: OrderConfirmation | undefined,
): string {
  if (!flow.reached) {
    return [
      `The order was NOT placed. The checkout ended on '${flow.verdict.state}': ${flow.verdict.why}`,
      flow.verdict.state === 'declined'
        ? 'The card was refused. The money is still on the card and comes back to the wallet when it is terminated.'
        : '',
      summarize(flow.pageState),
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `Order placed. ${formatARS(total)} charged.`,
    confirmation?.orderNumber ? `Order number: ${confirmation.orderNumber}` : '',
    confirmation?.statusUrl ? `See it yourself: ${confirmation.statusUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** True when a thrown error is the loop asking the user a question. */
export function isEscalation(e: unknown): e is Escalation {
  return e instanceof Escalation;
}
