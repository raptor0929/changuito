import { findButton, type PageState } from './pagestate.js';
import { actionFor, modalById } from './classify/modals.js';
import type { CheckoutState, Goal, Verdict } from './types.js';

/**
 * What to DO about a state.
 *
 * Planning is pure: `planAction` takes a verdict plus a page state and returns
 * a description of the next move. Executing it is the driver's job. The split
 * is what lets the whole control flow be unit-tested with no browser — and it
 * means every move the loop can make is enumerable and reviewable here, rather
 * than buried in Playwright calls.
 *
 * Every action must be IDEMPOTENT in effect: the loop re-observes and re-plans
 * after each one, so a screen shown twice simply produces the same plan twice.
 * That is why nothing here says "click the next button" — it says which button.
 */

export type Action =
  /** Click a control by its accessible name. */
  | { kind: 'click'; label: string; why: string }
  /** Fill the delivery address form from the address the user gave us. */
  | { kind: 'fill_address'; why: string }
  /** Enter the card. Only ever planned when the goal is 'confirmation'. */
  | { kind: 'fill_payment'; why: string }
  /** Fetch the OTP from Vyrion and type it into the challenge. */
  | { kind: 'submit_otp'; why: string }
  /** The page is working; give it time. */
  | { kind: 'wait'; ms: number; why: string }
  /** Nothing safe to do here. The loop escalates. */
  | { kind: 'none'; why: string };

export interface PlanContext {
  goal: Goal;
  /** False when no address has been captured yet, which makes 'address' fatal. */
  hasAddress?: boolean;
}

/** How long to sit on a "processing" screen before looking again. */
export const PROCESSING_WAIT_MS = 2_000;

/** Buttons that move a VTEX checkout forward, most specific first. */
const FORWARD = [
  /finalizar compra|iniciar compra/i,
  /ir a pagar|continuar al pago/i,
  /continuar|siguiente|continue/i,
];

/** Buttons that confirm a dialog without buying anything extra. */
const CONFIRM = /confirmar|es correcta|usar esta|aceptar|entendido|ok\b/i;

/**
 * Anything that could add an item, change a quantity or start a different
 * purchase. Never clicked by the loop — money decisions are the user's.
 */
const SPENDS = /agregar|añadir|sumar|comprar ahora|add to cart|eliminar|quitar/i;

export function planAction(verdict: Verdict, ps: PageState, ctx: PlanContext): Action {
  switch (verdict.state) {
    case 'interstitial': {
      const entry = verdict.modalId ? modalById(verdict.modalId) : undefined;
      const label = entry ? actionFor(entry, ps) : undefined;
      return label
        ? { kind: 'click', label, why: `dismiss the ${verdict.modalId} interstitial` }
        : { kind: 'none', why: `${verdict.modalId ?? 'an interstitial'} is open but has no dismiss control I recognise` };
    }

    case 'cart': {
      const label = firstForward(ps);
      return label
        ? { kind: 'click', label, why: 'leave the cart and start the checkout' }
        : { kind: 'none', why: 'no button on this cart moves toward checkout' };
    }

    case 'address':
      if (!ctx.hasAddress) {
        return { kind: 'none', why: 'the store wants a delivery address and none has been set' };
      }
      return { kind: 'fill_address', why: 'the store is asking for the delivery address' };

    case 'address_confirm': {
      const label = findButton(ps, CONFIRM) ?? firstForward(ps);
      return label
        ? { kind: 'click', label, why: 'confirm the address the store is showing' }
        : { kind: 'none', why: 'the address confirmation has no button I recognise' };
    }

    case 'shipping_slot': {
      // A slot picker usually needs a slot chosen and then confirmed. Choosing
      // is store-specific, so the loop only handles the confirm; if nothing is
      // selectable it stops rather than picking a delivery window blindly.
      const label = firstForward(ps) ?? findButton(ps, CONFIRM);
      return label
        ? { kind: 'click', label, why: 'accept the delivery option the store preselected' }
        : { kind: 'none', why: 'a delivery slot must be chosen and I cannot tell which' };
    }

    case 'payment_form':
      // Reaching here with goal 'payment_form' is impossible: the loop returns
      // on the goal before planning. So this is only the paying run.
      return { kind: 'fill_payment', why: 'enter the virtual card' };

    case 'threeds':
      return { kind: 'submit_otp', why: 'the bank is asking for a one-time code' };

    case 'processing':
      return { kind: 'wait', ms: PROCESSING_WAIT_MS, why: 'the store is still working' };

    case 'cart_changed':
      // Stock or price moved. That changes what the user approved, so it is
      // theirs to decide, not ours to click through.
      return { kind: 'none', why: 'the contents or the price of the order changed' };

    case 'profile':
      return { kind: 'none', why: 'the store is asking for identity data a linked session should already have' };

    default:
      return { kind: 'none', why: `no handler for state '${verdict.state}'` };
  }
}

/** The first forward-moving button present, skipping anything that spends. */
export function firstForward(ps: PageState): string | undefined {
  for (const re of FORWARD) {
    const hit = findButton(ps, re);
    if (hit && !SPENDS.test(hit)) return hit;
  }
  return undefined;
}

/** True when the loop can stop: this state satisfies the goal. */
export function satisfiesGoal(state: CheckoutState, goal: Goal): boolean {
  if (state === goal) return true;
  // Arriving straight at a placed order satisfies any goal — there is nothing
  // further to drive, and re-driving it would be the worst possible mistake.
  return state === 'confirmation';
}
