import type { OrderConfirmation } from './checkout/dia.js';
import type { FundingPlan } from './pay/funding.js';
import type { Centavos, DeliveryAddress } from './types.js';
import { formatARS } from './util/money.js';

/**
 * The order state machine.
 *
 * It exists for one reason: a model calling tools out of order must not be able
 * to skip an approval gate. `approve_payment` cannot run before the funds were
 * checked, which cannot run before a total was reviewed, which cannot run
 * before a cart was built in the user's own account. Each refusal names the
 * step that is missing rather than failing obscurely.
 *
 * Everything here is pure except the single module-level draft at the bottom,
 * which is kept explicit so swapping it for real persistence is a small change.
 */

export type OrderStage =
  /** Browsing. No account linked yet. */
  | 'searching'
  /** A session is linked; the store knows who the user is. */
  | 'linked'
  /** A delivery address has been given. */
  | 'addressed'
  /** Items are in the user's real cart at the store. */
  | 'cart_built'
  /** The checkout was driven to the payment step and a total was shown. */
  | 'reviewed'
  /** The total was converted and checked against the settled balance. */
  | 'funds_checked'
  /** Paid. Terminal. */
  | 'order_placed';

/** Ordered. A stage implies every stage before it. */
export const STAGES: readonly OrderStage[] = [
  'searching',
  'linked',
  'addressed',
  'cart_built',
  'reviewed',
  'funds_checked',
  'order_placed',
];

export const stageIndex = (s: OrderStage): number => STAGES.indexOf(s);
export const atLeast = (current: OrderStage, needed: OrderStage): boolean =>
  stageIndex(current) >= stageIndex(needed);

/** The tool that gets you from the stage before to the stage named. */
const REACHED_BY: Record<OrderStage, string> = {
  searching: 'search_products',
  linked: 'link_marketplace_account',
  addressed: 'set_delivery_address',
  cart_built: 'build_cart',
  reviewed: 'review_order',
  funds_checked: 'check_funds',
  order_placed: 'approve_payment',
};

/** What each gated tool needs to have happened first. */
export const REQUIRES: Record<string, OrderStage> = {
  set_delivery_address: 'linked',
  build_cart: 'addressed',
  review_order: 'cart_built',
  check_funds: 'reviewed',
  approve_payment: 'funds_checked',
};

export class OrderStateError extends Error {
  constructor(
    readonly tool: string,
    readonly needed: OrderStage,
    readonly current: OrderStage,
    message: string,
  ) {
    super(message);
    this.name = 'OrderStateError';
  }
}

export interface OrderDraft {
  stage: OrderStage;
  address?: DeliveryAddress;
  orderFormId?: string;
  /** What review_order showed and the user is being asked to approve. */
  totalCentavos?: Centavos;
  cartUrl?: string;
  plan?: FundingPlan;
  confirmation?: OrderConfirmation;
  placedAt?: string;
  /** Card id, kept only so a failed run can be cleaned up by hand if needed. */
  cardId?: string;
}

/** Pure: may this tool run from this draft? */
export function checkTransition(tool: string, draft: OrderDraft): void {
  const needed = REQUIRES[tool];
  if (!needed) return;

  if (draft.stage === 'order_placed' && tool !== 'review_order') {
    throw new OrderStateError(
      tool,
      needed,
      draft.stage,
      'This order has already been placed. Start a new one with build_cart — ' +
        'nothing here can modify an order the store has accepted.',
    );
  }

  if (!atLeast(draft.stage, needed)) {
    throw new OrderStateError(
      tool,
      needed,
      draft.stage,
      `${tool} needs '${needed}' first. You are at '${draft.stage}'. ` +
        `Run ${REACHED_BY[needed]} before this.`,
    );
  }
}

/**
 * The approval gate proper. The user must restate the exact ARS total; anything
 * else aborts. Not a formality — it is the check that catches a price that
 * moved between review_order and approve_payment.
 */
export function checkApproval(draft: OrderDraft, restatedCentavos: Centavos): void {
  if (draft.totalCentavos === undefined) {
    throw new OrderStateError(
      'approve_payment',
      'reviewed',
      draft.stage,
      'No reviewed total to approve. Run review_order first.',
    );
  }
  if (restatedCentavos !== draft.totalCentavos) {
    throw new Error(
      `You restated ${formatARS(restatedCentavos)} but the reviewed total is ` +
        `${formatARS(draft.totalCentavos)}. Nothing was paid. If the price moved, ` +
        're-run review_order and approve the new figure.',
    );
  }
  if (draft.plan?.status !== 'ready') {
    throw new Error(
      `The funding check says '${draft.plan?.status ?? 'unknown'}', not 'ready'. ` +
        'Run check_funds and, if you are short, replenish_wallet.',
    );
  }
}

/** Advance, never backwards: a later stage is never silently un-done. */
export function advance(draft: OrderDraft, to: OrderStage): OrderDraft {
  return atLeast(draft.stage, to) ? draft : { ...draft, stage: to };
}

/**
 * Changing the cart invalidates the approvals that were made about it. Anything
 * that mutates items must call this, or a user could approve one basket and pay
 * for another.
 */
export function invalidateApprovals(draft: OrderDraft): OrderDraft {
  if (!atLeast(draft.stage, 'reviewed')) return draft;
  return {
    ...draft,
    stage: 'cart_built',
    totalCentavos: undefined,
    plan: undefined,
  };
}

// ---- the single live draft -------------------------------------------------

let draft: OrderDraft = { stage: 'searching' };

export const getDraft = (): OrderDraft => draft;
export const setDraft = (next: OrderDraft): OrderDraft => (draft = next);
export const updateDraft = (patch: Partial<OrderDraft>): OrderDraft => (draft = { ...draft, ...patch });
export const resetOrder = (): OrderDraft => (draft = { stage: 'searching' });

/** Guard + mutate in one call, for the tool handlers. */
export function requireStage(tool: string): OrderDraft {
  checkTransition(tool, draft);
  return draft;
}

export function describeDraft(d: OrderDraft = draft): string {
  const lines = [`Stage: ${d.stage}`];
  if (d.address) lines.push(`Address: ${d.address.street} ${d.address.number}, CP ${d.address.postalCode}`);
  if (d.orderFormId) lines.push(`Cart: ${d.orderFormId}`);
  if (d.totalCentavos !== undefined) lines.push(`Reviewed total: ${formatARS(d.totalCentavos)}`);
  if (d.plan) lines.push(`Funding: ${d.plan.status}`);
  if (d.confirmation?.orderNumber) lines.push(`Order: ${d.confirmation.orderNumber}`);
  return lines.join('\n');
}
