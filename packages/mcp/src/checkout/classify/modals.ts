import type { CheckoutState, Verdict } from '../types.js';
import { type PageState, hasField, hasText } from '../pagestate.js';

/**
 * LAYER 2 — the known-screen registry.
 *
 * Everything that is a real screen but not a route change: cookie banners,
 * "¿es esta tu dirección?", delivery-slot pickers, upsell popups, 3DS
 * challenges, declines. Layer 1 cannot see these because the orderForm does not
 * change when they appear.
 *
 * Each entry is a match (pure, over PageState) plus the accessible NAME of the
 * control that advances it. Names, not CSS: a role/label locator survives a
 * restyle, and a class name does not. Adding a newly-discovered screen is one
 * entry.
 *
 * Spanish first — this is an Argentine storefront — with the English variants
 * kept because VTEX's own components are not always translated.
 */

export interface ModalEntry {
  id: string;
  state: CheckoutState;
  /** Cheap structural test against the extracted page. */
  match: (ps: PageState) => boolean;
  /** Accessible name of the control that advances or dismisses this screen. */
  action?: RegExp;
  /** Never click these, even if they match `action` — upsells love a green button. */
  avoid?: RegExp;
  /** Higher wins when several entries match. */
  priority: number;
  why: string;
}

const ACCEPT = /aceptar|entendido|continuar|de acuerdo|ok|got it|accept/i;
const CONFIRM = /confirmar|confirmo|es correcta|sí|si,|yes|continuar|siguiente/i;
const DISMISS = /cerrar|no, gracias|no gracias|omitir|saltar|más tarde|close|skip|dismiss|×/i;

export const MODALS: ModalEntry[] = [
  {
    id: 'cookie_banner',
    state: 'interstitial',
    priority: 10,
    action: ACCEPT,
    match: (ps) =>
      hasText(ps, /cookies?\b/i) && hasText(ps, /aceptar|acepto|entendido|accept/i),
    why: 'cookie consent banner',
  },
  {
    id: 'session_expired',
    state: 'session_expired',
    priority: 95,
    match: (ps) =>
      hasText(ps, /sesi[oó]n (ha )?(expirad|caducad|finalizad)|volv[eé] a iniciar sesi[oó]n|session (has )?expired/i) ||
      hasField(ps, /contrase|password/i),
    why: 'the store is asking to sign in again',
  },
  {
    id: 'declined',
    state: 'declined',
    priority: 94,
    match: (ps) =>
      hasText(ps, /rechazad|no pudimos procesar|pago no (fue )?aprobad|tarjeta (fue )?rechazad|declined|payment failed/i),
    why: 'the payment was refused',
  },
  {
    id: 'threeds',
    state: 'threeds',
    priority: 90,
    match: (ps) =>
      hasText(ps, /c[oó]digo de (verificaci[oó]n|seguridad)|3d ?secure|autenticaci[oó]n|one[- ]time|OTP|token de seguridad/i) ||
      hasField(ps, /c[oó]digo|otp|token/i),
    why: 'a one-time-code challenge is on screen',
  },
  {
    id: 'address_confirm',
    state: 'address_confirm',
    priority: 70,
    action: CONFIRM,
    match: (ps) =>
      hasText(ps, /confirm[aá].*(direcci[oó]n|domicilio)|es (esta|tu) (la )?direcci[oó]n|¿?es correcta la direcci[oó]n/i),
    why: 'the store wants the delivery address confirmed',
  },
  {
    id: 'shipping_slot',
    state: 'shipping_slot',
    priority: 60,
    action: /confirmar|continuar|elegir|seleccionar|siguiente/i,
    match: (ps) =>
      hasText(ps, /eleg[ií] (el )?(d[ií]a|horario|franja)|fecha de entrega|horario de entrega|delivery (date|window)/i),
    why: 'a delivery day or window has to be chosen',
  },
  {
    id: 'out_of_stock',
    state: 'cart_changed',
    priority: 80,
    match: (ps) =>
      hasText(ps, /sin stock|no hay stock|agotad|no est[aá] disponible|out of stock|el precio (cambi|subi)/i),
    why: 'the store says the cart changed under us',
  },
  {
    id: 'upsell',
    state: 'interstitial',
    priority: 20,
    action: DISMISS,
    // Deliberately narrow: "agregar" appears all over a supermarket. The tell
    // is a dialog that is offering something rather than asking for something.
    avoid: /agregar|añadir|comprar|sumar|add/i,
    match: (ps) =>
      ps.dialogText.length > 0 &&
      hasText(ps, /te puede interesar|sumale|agreg[aá] a tu compra|no te olvides|completa tu compra|recomendad/i),
    why: 'a dismissible upsell popup',
  },
  {
    id: 'newsletter',
    state: 'interstitial',
    priority: 15,
    action: DISMISS,
    match: (ps) => ps.dialogText.length > 0 && hasText(ps, /newsletter|suscrib|descuento en tu primera/i),
    why: 'a dismissible subscription popup',
  },
  {
    id: 'confirmation',
    state: 'confirmation',
    priority: 99,
    match: (ps) =>
      hasText(ps, /gracias por tu compra|pedido (confirmad|realizad)|compra exitosa|n[uú]mero de pedido|order placed/i),
    why: 'the order-placed screen',
  },
];

export function classifyModal(ps: PageState): Verdict | undefined {
  const hits = MODALS.filter((m) => safeMatch(m, ps)).sort((a, b) => b.priority - a.priority);
  const hit = hits[0];
  if (!hit) return undefined;
  return {
    state: hit.state,
    confidence: 1,
    layer: 'modal',
    why: hit.why,
    modalId: hit.id,
  };
}

/** A bad regex in one entry must not take down the classifier. */
function safeMatch(m: ModalEntry, ps: PageState): boolean {
  try {
    return m.match(ps);
  } catch {
    return false;
  }
}

export function modalById(id: string): ModalEntry | undefined {
  return MODALS.find((m) => m.id === id);
}

/** The button this screen wants pressed, if we know one and it is present. */
export function actionFor(entry: ModalEntry, ps: PageState): string | undefined {
  if (!entry.action) return undefined;
  return ps.buttons.find((b) => entry.action!.test(b) && !(entry.avoid?.test(b) ?? false));
}
