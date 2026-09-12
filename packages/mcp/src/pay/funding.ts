import type { Centavos } from '../types.js';
import { formatARS } from '../util/money.js';
import { DEFAULT_BUFFER, arsToUsdCents } from './fx.js';
import { CARD_MAX_CENTS, CARD_MIN_CENTS, formatUsd } from './vyrion.js';
import type { UsdCents } from './types.js';

/**
 * Decides whether a purchase can go ahead, and for how much.
 *
 * Pure: no network, no clock, no config reading. Everything it needs is an
 * argument, which is what lets the whole decision matrix be unit-tested — this
 * is the function that decides how much of someone's money moves, so it is the
 * one that most needs to be testable without a card, a wallet or a store.
 *
 * THE INVARIANT: `pendingUsdCents` is carried for display and never read by the
 * decision. A deposit that has not confirmed is not money we have. Counting it
 * would mean funding a card against crypto that could still reorg away.
 */

export interface FundingInput {
  /** Order total in ARS centavos, as read from the orderForm. */
  arsTotal: Centavos;
  /** Pesos per dollar. */
  arsPerUsd: number;
  /** Settled, spendable Vyrion balance. */
  settledUsdCents: UsdCents;
  /** Unconfirmed deposits. Display only — see the invariant above. */
  pendingUsdCents?: UsdCents;
  buffer?: number;
}

interface Common {
  /** What the card must be loaded with, buffer included. */
  requiredUsdCents: UsdCents;
  /** Required before the buffer, for showing the user what the buffer cost. */
  bareUsdCents: UsdCents;
  arsTotal: Centavos;
  arsPerUsd: number;
  buffer: number;
  settledUsdCents: UsdCents;
  pendingUsdCents: UsdCents;
}

export type FundingPlan =
  | (Common & {
      status: 'ready';
      /** Balance left after this purchase. */
      remainingUsdCents: UsdCents;
      /** True when the order was under Vyrion's $1 card minimum and we rounded up to it. */
      raisedToCardMinimum: boolean;
    })
  | (Common & { status: 'short'; shortfallUsdCents: UsdCents })
  | (Common & { status: 'over_card_limit' })
  | (Common & { status: 'zero_total' });

export function decideFunding(input: FundingInput): FundingPlan {
  const buffer = input.buffer ?? DEFAULT_BUFFER;
  const pendingUsdCents = input.pendingUsdCents ?? 0;

  const bareUsdCents = input.arsTotal > 0 ? arsToUsdCents(input.arsTotal, input.arsPerUsd, 0) : 0;
  const withBuffer = input.arsTotal > 0 ? arsToUsdCents(input.arsTotal, input.arsPerUsd, buffer) : 0;

  // Vyrion will not issue a card under $1. A very small basket is not an error:
  // load the minimum and let the remainder come back on termination.
  const raisedToCardMinimum = withBuffer > 0 && withBuffer < CARD_MIN_CENTS;
  const requiredUsdCents = raisedToCardMinimum ? CARD_MIN_CENTS : withBuffer;

  const common: Common = {
    requiredUsdCents,
    bareUsdCents,
    arsTotal: input.arsTotal,
    arsPerUsd: input.arsPerUsd,
    buffer,
    settledUsdCents: input.settledUsdCents,
    pendingUsdCents,
  };

  if (input.arsTotal <= 0) return { ...common, status: 'zero_total' };
  if (requiredUsdCents > CARD_MAX_CENTS) return { ...common, status: 'over_card_limit' };

  // The one line where the invariant lives: settled only.
  if (input.settledUsdCents < requiredUsdCents) {
    return { ...common, status: 'short', shortfallUsdCents: requiredUsdCents - input.settledUsdCents };
  }

  return {
    ...common,
    status: 'ready',
    remainingUsdCents: input.settledUsdCents - requiredUsdCents,
    raisedToCardMinimum,
  };
}

/** A plain-language summary for the chat. Never abbreviates the amounts. */
export function explainFunding(plan: FundingPlan): string {
  const rate = `1 USD = ${formatARS(Math.round(plan.arsPerUsd * 100))}`;
  const head =
    `Order total: ${formatARS(plan.arsTotal)}\n` +
    `Rate:        ${rate}\n` +
    `Settled Vyrion balance: ${formatUsd(plan.settledUsdCents)}` +
    (plan.pendingUsdCents > 0
      ? `\nPending deposits:       ${formatUsd(plan.pendingUsdCents)} (not counted — unconfirmed)`
      : '');

  switch (plan.status) {
    case 'ready': {
      const bufferCost = plan.requiredUsdCents - plan.bareUsdCents;
      return (
        `${head}\n\n` +
        `Card to be funded with ${formatUsd(plan.requiredUsdCents)} ` +
        `(${formatUsd(plan.bareUsdCents)} + ${Math.round(plan.buffer * 100)}% FX buffer ` +
        `of ${formatUsd(bufferCost)}).\n` +
        (plan.raisedToCardMinimum
          ? `Raised to Vyrion's ${formatUsd(CARD_MIN_CENTS)} card minimum.\n`
          : '') +
        `The buffer is not spent: the card's limit is set to exactly this amount and the\n` +
        `card is terminated after settlement, returning whatever is left to the wallet.\n` +
        `Balance after: ${formatUsd(plan.remainingUsdCents)}.`
      );
    }
    case 'short':
      return (
        `${head}\n\n` +
        `NOT ENOUGH. Need ${formatUsd(plan.requiredUsdCents)}, short by ` +
        `${formatUsd(plan.shortfallUsdCents)}.\n` +
        `Top the wallet up with replenish_wallet — the order draft is kept, and the\n` +
        `purchase can go ahead once the deposit confirms.`
      );
    case 'over_card_limit':
      return (
        `${head}\n\n` +
        `Too large for a single card: ${formatUsd(plan.requiredUsdCents)} exceeds Vyrion's ` +
        `${formatUsd(CARD_MAX_CENTS)} maximum. Split the order.`
      );
    case 'zero_total':
      return `${head}\n\nThe cart total is zero — nothing to pay for.`;
  }
}
