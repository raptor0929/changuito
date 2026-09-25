/**
 * Every word the checkout flow says out loud, in one place.
 *
 * Same reason mode-copy.ts exists: lib/agent/prompt.ts forbids the model from
 * saying wallet, escrow, blockchain or the name of a network to a shopper, and
 * an app where the model is careful and the buttons are not would be a strange
 * one. Strings scattered through JSX cannot be checked; strings in a module
 * can, and lib/test/checkout-copy.test.ts runs the same regex over all of them.
 *
 * The second reason is the harder one. This flow has three steps that are easy
 * to describe dishonestly — a deposit the app cannot refund automatically, a
 * frame the app cannot see into, and a "paid" the store only half confirms.
 * Keeping the sentences together makes it obvious when one of them starts
 * claiming more than the code behind it knows.
 */
import { type NetworkId } from './deployments.ts';

export interface CheckoutCopy {
  /** The dialog's own name. */
  title: string;
  depositTitle: string;
  /** What the shopper is being asked to send, and why. */
  depositLead: string;
  amountLabel: string;
  addressLabel: string;
  memoLabel: string;
  /** Under the memo field. It is the whole reason the money finds the order. */
  memoNote: string;
  waiting: string;
  confirmed: string;
  /** Said once, plainly, because it is the part that cannot be undone by a button. */
  refundNote: string;
  checkoutTitle: string;
  checkoutLead: string;
  loginLead: string;
  loginCta: string;
  identified: string;
  openTab: string;
  /** Beside "abrir en una pestaña", so it does not read as a failure. */
  openTabNote: string;
  paidCta: string;
  checking: string;
  /** Shown when the store corroborates. Deliberately not "confirmamos tu pago". */
  verified: string;
  /** Shown when it does not, which is not the same as "you did not pay". */
  unverified: string;
  unreachable: string;
  /** Says what went wrong and what happens next, with no automatic remedy implied. */
  failed: string;
}

const COMMON = {
  title: 'Terminar la compra',
  depositTitle: 'Paso 1: mandá el importe',
  amountLabel: 'Importe',
  addressLabel: 'Dirección',
  memoLabel: 'Código',
  memoNote: 'Va sí o sí: es lo que hace que el importe caiga en esta compra y no en otra.',
  waiting: 'Esperando que llegue…',
  confirmed: '¡Llegó! Ya podés seguir.',
  checkoutTitle: 'Paso 2: pagá en el súper',
  checkoutLead: 'Esta es la página del súper, tal cual. Nosotros no vemos lo que pasa adentro.',
  loginLead: 'Para pagar necesitás entrar a tu cuenta del súper. Se abre en una pestaña aparte, en la página del súper, con la barra de direcciones a la vista.',
  loginCta: 'Entrar a mi cuenta del súper',
  identified: 'Listo, te reconoció el súper.',
  openTab: 'Abrir en una pestaña',
  openTabNote: 'Funciona igual de bien. Algunos navegadores no dejan iniciar sesión acá adentro.',
  paidCta: 'Ya lo pagué',
  checking: 'Chequeando con el súper…',
  verified: 'El súper nos confirma que el changuito se cerró.',
  unverified: 'El súper todavía nos muestra el changuito abierto. Si ya pagaste, seguí igual y revisalo en tu cuenta del súper.',
  unreachable: 'No pudimos chequearlo con el súper en este momento.',
} as const;

const PRUEBA: CheckoutCopy = {
  ...COMMON,
  depositLead: 'Es una prueba: mandá el importe de prueba a esta dirección con este código y seguimos.',
  refundNote: 'Es una prueba, así que no se mueve plata real.',
  failed: 'Algo salió mal. Como es una prueba, no hay nada que devolver.',
};

const REAL: CheckoutCopy = {
  ...COMMON,
  depositLead: 'Mandá este importe a esta dirección, con este código, desde donde tengas tus USDC.',
  // No automated outbound payment exists, and none is going to be implied.
  refundNote: 'Si algo sale mal, te devolvemos el importe a mano. No es automático.',
  failed: 'No pudimos completar la compra. Escribinos y te devolvemos el importe a mano.',
};

export const CHECKOUT_MODES = [PRUEBA, REAL] as const;

export function checkoutCopy(net: NetworkId): CheckoutCopy {
  return net === 'mainnet' ? REAL : PRUEBA;
}
