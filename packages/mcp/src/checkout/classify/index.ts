import type { VtexOrderForm } from '../../adapters/orderform.js';
import type { PageState } from '../pagestate.js';
import type { Verdict } from '../types.js';
import { classifyModal } from './modals.js';
import { classifyOrderForm, collectProblems, stepFromUrl } from './orderform.js';

/**
 * Composing the layers.
 *
 * The rule, and why it is not simply "layer 1 first":
 *
 *   1. An orderGroup, or an empty cart, is PROOF. Nothing overrides it.
 *   2. Otherwise a matched modal wins, because a dialog is literally on top of
 *      the page — the underlying step is irrelevant until it is dealt with.
 *   3. Otherwise, if we are still LOOKING at the cart, the state is 'cart'
 *      however satisfied the document is — a returning customer with a saved
 *      address has an orderForm that says "payment_form" while the screen is
 *      still a cart with a "Finalizar compra" button on it. Believing the
 *      document here would make the loop declare victory at the cart.
 *   4. Otherwise the orderForm says which step the store is on.
 *   5. Otherwise Jev, which the caller supplies (it is async and optional).
 *   6. Otherwise nobody knows, and the caller escalates to the user.
 *
 * Problems found in the orderForm — price changes, stock losses — are attached
 * to whichever verdict wins, because they can arrive on any screen.
 */

export interface ClassifyInput {
  pageState: PageState;
  orderForm?: VtexOrderForm;
}

export function classifyDeterministic(input: ClassifyInput): Verdict | undefined {
  const fromOf = classifyOrderForm(input.orderForm, input.pageState.url);
  if (fromOf && (fromOf.state === 'confirmation' || fromOf.state === 'empty_cart')) return fromOf;

  const problems = input.orderForm ? collectProblems(input.orderForm) : [];
  const attach = (v: Verdict): Verdict => (problems.length ? { ...v, problems } : v);

  const fromModal = classifyModal(input.pageState);
  if (fromModal) return attach(fromModal);

  if (onCartPage(input.pageState.url)) {
    return attach({
      state: 'cart',
      confidence: 1,
      layer: 'orderform',
      why: fromOf
        ? `the cart is on screen; the orderForm's next unsatisfied step is '${fromOf.state}'`
        : 'the cart is on screen',
    });
  }

  return fromOf;
}

/** The cart step, whether it is the store's cart page or checkout's #/cart route. */
export function onCartPage(url: string): boolean {
  return stepFromUrl(url) === 'cart' || /\/(cart|carrito|carrinho)(\/|\?|$)/i.test(url.split('#')[0]);
}

export { classifyModal, classifyOrderForm };
