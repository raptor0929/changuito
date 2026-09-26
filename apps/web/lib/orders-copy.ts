import type { OrderStatus } from './db.ts';
import { PREVIEW_MASTHEAD } from './mode-copy.ts';

/**
 * The words on /mis-compras, and the two numbers on every line.
 *
 * A module rather than strings in the JSX for the reason mode-copy.ts gives:
 * the chrome obeys the same rule as the agent, so none of these may name a
 * network, a chain or a wallet, and a test iterates the lot to check. The
 * shopper reads "compras", "código" and "pesos" here and nothing else.
 *
 * `pesos` and `dollars` live here too because they are the same decision as
 * the wording. An order carries both figures deliberately — `arsQuoted` is
 * what the shopper actually read on screen, `amountCents` is what was sent —
 * and the rate moves between the two, so the page shows the one they saw and
 * falls back only when there is no such figure.
 */

export interface PurchasesCopy {
  title: string;
  lead: string;
  /** Signed out, which is to say preview: nothing is kept, and that is fine. */
  guestTitle: string;
  guestBody: string;
  /** The same words the masthead uses, so the crossing reads the same twice. */
  guestAction: string;
  /** Before the signature, so nobody is surprised by their wallet opening. */
  signLead: string;
  loadCta: string;
  loading: string;
  signRefused: string;
  error: string;
  empty: string;
  back: string;
  codeLabel: string;
  /** Under a line that ended in a card of ours rather than the shopper's own. */
  cardNote: string;
}

export const PURCHASES: PurchasesCopy = {
  title: 'Mis compras',
  lead: 'Lo que compraste con Changuito, desde cualquier dispositivo.',
  guestTitle: 'Acá no hay nada guardado',
  guestBody:
    'En modo prueba no guardamos nada: probás el pago entero y no queda registro. Entrá con tu cuenta y tus compras quedan acá.',
  guestAction: PREVIEW_MASTHEAD.action,
  signLead: 'Te pedimos una firma para confirmar que sos vos. Es gratis y no mueve plata.',
  loadCta: 'Ver mis compras',
  loading: 'Buscando tus compras…',
  signRefused: 'No pudimos confirmar que sos vos. Probá de nuevo.',
  error: 'No pudimos traer tus compras ahora. Probá de nuevo en un rato.',
  empty: 'Todavía no compraste nada con esta cuenta.',
  back: 'Volver al chat',
  codeLabel: 'Código',
  cardNote: 'Pagada con una tarjeta que te dimos nosotros.',
};

/**
 * What each status is called in front of the person who owns the order.
 *
 * `paid` and `carded` read the same on purpose. The difference between them is
 * that a card was issued, which is machinery — it is not a step the shopper
 * took and not one they can act on, and a separate word for it would invite
 * them to wonder what they are supposed to do about it. Whether a card exists
 * is its own line (`cardNote`), where it belongs.
 *
 * `quoted` says "sin pagar" rather than "esperando", because an order can sit
 * there for ever: the shopper was given a código and never sent anything, and
 * a word that implies we are still waiting would be a promise to keep looking.
 */
export const ORDER_STATUS: Record<OrderStatus, string> = {
  quoted: 'Sin pagar',
  paid: 'Pagada',
  carded: 'Pagada',
  done: 'Terminada',
  failed: 'No se completó',
};

/** Everything the copy test iterates. One place to add to. */
export const PURCHASES_COPY: readonly string[] = [
  ...Object.values(PURCHASES),
  ...Object.values(ORDER_STATUS),
];

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

/** Centavos as the shopper read them. */
export function pesos(centavos: number): string {
  return ARS.format(centavos / 100);
}

/**
 * US cents, for an order quoted before `ars_quoted` was a column — and for
 * one where the pesos figure was lost to a database that was briefly down.
 * Hand-formatted rather than `Intl`, which writes "US$ 12,34" on some
 * runtimes and "$US 12,34" on others; this is a fallback and it should not
 * be the interesting part of the line.
 */
export function dollars(cents: number): string {
  return `US$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const DAY = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

/** An ISO string from the API, as a date. Invalid input reads as empty. */
export function purchaseDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : DAY.format(at);
}
