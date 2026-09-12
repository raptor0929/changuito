import type { VtexOrderForm } from '../../adapters/orderform.js';
import type { CheckoutState, Verdict } from '../types.js';

/**
 * LAYER 1 — the exact, free one.
 *
 * VTEX Checkout is a route-driven SPA over an orderForm document, and that
 * document states which step is satisfied and what is blocking the next one.
 * No DOM inspection, no heuristics, no model call: read the sections in order
 * and the answer falls out.
 *
 * Because it is pure, the main path of the whole flow is testable against saved
 * orderForm JSON with no browser involved. That is the highest-leverage test in
 * the suite, which is why this file has no Playwright import.
 */

/** Order matters: the first unsatisfied section is what the store is asking for. */
export function classifyOrderForm(of: VtexOrderForm | undefined, url = ''): Verdict | undefined {
  if (!of) return undefined;

  const problems = collectProblems(of);
  const v = (state: CheckoutState, why: string): Verdict => ({
    state,
    confidence: 1,
    layer: 'orderform',
    why,
    ...(problems.length ? { problems } : {}),
  });

  // Placed. orderGroup only appears once the order exists, so this is the one
  // unambiguous success signal in the document.
  if (of.orderGroup) return v('confirmation', `orderForm carries orderGroup ${of.orderGroup}`);

  if ((of.items ?? []).length === 0) return v('empty_cart', 'orderForm has no items');

  const profile = of.clientProfileData;
  if (!profile?.email) return v('profile', 'clientProfileData has no email — not signed in');

  const address = of.shippingData?.address;
  if (!address || !hasUsableAddress(address)) {
    return v('address', 'shippingData.address is absent or incomplete');
  }

  const logistics = of.shippingData?.logisticsInfo ?? [];
  const unslotted = logistics.filter((l) => !l.selectedSla);
  if (logistics.length > 0 && unslotted.length > 0) {
    return v(
      'shipping_slot',
      `${unslotted.length} of ${logistics.length} item group(s) have no selectedSla`,
    );
  }

  const payments = of.paymentData?.payments ?? [];
  if (payments.length === 0) return v('payment_form', 'paymentData.payments is empty');

  // Everything the document can be asked for is present. Whether the button has
  // been pressed is a DOM question, so hand it to the next layer rather than
  // claiming a state we cannot see.
  if (/#\/(payment|checkout)/.test(url) || url.includes('/checkout')) {
    return v('processing', 'every orderForm section is satisfied and payment is attached');
  }
  return undefined;
}

/**
 * A VTEX address object is created before it is filled in, so "not null" is not
 * the same as "usable". Street plus either a number or a postal code is the
 * minimum Día will ship to.
 */
function hasUsableAddress(a: NonNullable<NonNullable<VtexOrderForm['shippingData']>['address']>): boolean {
  return Boolean(a.street && (a.number || a.postalCode));
}

/**
 * Store-side messages that change what the user is agreeing to. Surfaced
 * alongside every verdict rather than turned into a state of their own, because
 * "the price changed" can arrive on any screen.
 */
export function collectProblems(of: VtexOrderForm): string[] {
  const out: string[] = [];
  for (const m of of.messages ?? []) {
    if (!m.text) continue;
    if (m.status && m.status.toLowerCase() === 'success') continue;
    out.push(m.text);
  }
  for (const it of of.items ?? []) {
    if (it.availability && it.availability !== 'available') {
      out.push(`${it.name ?? it.id}: ${it.availability}`);
    }
  }
  return out;
}

/** True when the document says something the user must re-approve. */
export function needsReapproval(of: VtexOrderForm): boolean {
  return (of.messages ?? []).some((m) =>
    /price|precio|stock|disponib|agotad/i.test(`${m.code ?? ''} ${m.text ?? ''}`),
  );
}

/** The URL hash VTEX uses for each step, for corroboration and for navigation. */
export function stepFromUrl(url: string): CheckoutState | undefined {
  const hash = url.split('#')[1] ?? '';
  if (/^\/cart/.test(hash)) return 'cart';
  if (/^\/profile/.test(hash)) return 'profile';
  if (/^\/shipping/.test(hash)) return 'address';
  if (/^\/payment/.test(hash)) return 'payment_form';
  if (/orderPlaced|\/confirmation/i.test(url)) return 'confirmation';
  return undefined;
}
