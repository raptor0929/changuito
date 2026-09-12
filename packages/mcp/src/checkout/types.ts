/**
 * The vocabulary the navigation loop speaks.
 *
 * A "state" is a screen the flow can be on, not a step it must pass through in
 * order. That distinction is the whole design: Día inserts address
 * confirmations, slot pickers and upsells wherever it likes, and a loop that
 * matches on state rather than on sequence does not care.
 */

export type CheckoutState =
  /** Cart is empty — nothing to check out. */
  | 'empty_cart'
  /** Items present, nothing else satisfied yet. */
  | 'cart'
  /** Needs identity: email/name/DNI. Should never happen on a linked session. */
  | 'profile'
  /** Needs a delivery address. */
  | 'address'
  /** An address exists and the store wants it confirmed or corrected. */
  | 'address_confirm'
  /** Needs a delivery day/window chosen. */
  | 'shipping_slot'
  /** Needs card details. */
  | 'payment_form'
  /** Bank one-time-code challenge. */
  | 'threeds'
  /** Submitted, waiting for the gateway. */
  | 'processing'
  /** Order placed. Terminal, and the only success. */
  | 'confirmation'
  /** The payment was refused. Terminal. */
  | 'declined'
  /** Signed out mid-flow. Terminal. */
  | 'session_expired'
  /** Store says an item is gone or the price moved. Needs a decision. */
  | 'cart_changed'
  /** A dismissible interstitial: cookies, upsell, newsletter. */
  | 'interstitial'
  /** Everything the classifier could not name. */
  | 'unknown';

/** States the loop must stop on, whatever the budget says. */
export const TERMINAL: ReadonlySet<CheckoutState> = new Set<CheckoutState>([
  'confirmation',
  'declined',
  'session_expired',
  'empty_cart',
]);

export type ClassifierLayer = 'orderform' | 'modal' | 'jev' | 'escalation';

export interface Verdict {
  state: CheckoutState;
  /** 1 for the deterministic layers; Jev's own figure otherwise. */
  confidence: number;
  layer: ClassifierLayer;
  /** Why this verdict — shown to the user on an escalation, and in logs. */
  why: string;
  /** For 'interstitial': which registry entry matched. */
  modalId?: string;
  /** For 'threeds': how the challenge is presented, once known. */
  threeDsKind?: 'inline_input' | 'iframe' | 'redirect';
  /** Store-side problems worth surfacing whatever the state. */
  problems?: string[];
}

/** What the loop is trying to reach. Stops as soon as the goal is satisfied. */
export type Goal = 'payment_form' | 'confirmation';

export class Escalation extends Error {
  constructor(
    message: string,
    readonly verdict: Verdict,
    readonly screenshotPath?: string,
    readonly summary?: string,
  ) {
    super(message);
    this.name = 'Escalation';
  }
}
