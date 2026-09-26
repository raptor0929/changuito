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
  /**
   * Preview only. There is no wallet to send from and nothing to copy — the
   * demo wallet pays, one button, and the rest of the flow is unchanged.
   * Empty on the real side, where offering to pay for somebody would be a lie.
   */
  demoPayCta: string;
  demoPayWorking: string;
  /** The default reason, when the server has none worth reading out. */
  demoPayError: string;
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
  /** The optional single-use card. Optional in the copy too — the frame already
   *  takes the shopper's own card, and this must never read as the only way. */
  cardTitle: string;
  cardLead: string;
  cardCta: string;
  cardMinting: string;
  /**
   * The returning customer, production only. There is one card per person, so
   * a second deposit tops up the first — and somebody who is shown "Generar
   * una tarjeta" again will reasonably conclude they are about to be given a
   * second one, which is the one thing the product promises not to do.
   *
   * Empty in the test mode, where the card really is per-basket and there is
   * nothing to come back to.
   */
  cardAgainLead: string;
  cardAgainCta: string;
  /** Under the numbers. Says where they live, which is nowhere. */
  cardNote: string;
  cardNumberLabel: string;
  cardExpiryLabel: string;
  cardCvvLabel: string;
  cardFunded: string;
  /** The default reason, when the server has none worth reading out. */
  cardError: string;
  /** Printed under every card failure, whatever the reason: the frame still
   *  takes the shopper's own card, so no failure here is a dead end. */
  cardFallback: string;
  otpTitle: string;
  /** The field's own label, under the heading that already said it once. */
  otpLabel: string;
  otpWaiting: string;
  /** The code is on screen and running out; the countdown is beside it. */
  otpLead: string;
  otpExpired: string;
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
  amountLabel: 'Importe',
  addressLabel: 'Dirección',
  memoLabel: 'Código',
  memoNote: 'Va sí o sí: es lo que hace que el importe caiga en esta compra y no en otra.',
  waiting: 'Esperando que llegue…',
  confirmed: '¡Llegó! Ya podés seguir.',
  demoPayCta: '',
  demoPayWorking: '',
  demoPayError: '',
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
  cardTitle: 'Tarjeta de un solo uso',
  cardLead: 'Podés pagar con tu tarjeta de siempre en el formulario del súper. O, si preferís no ponerla, te damos una que sirve una sola vez y nada más que para esta compra.',
  cardCta: 'Generar una tarjeta',
  cardMinting: 'Generando…',
  cardAgainLead: '',
  cardAgainCta: '',
  cardNumberLabel: 'Número',
  cardExpiryLabel: 'Vence',
  cardCvvLabel: 'Código de seguridad',
  cardError: 'No pudimos generar la tarjeta.',
  cardFallback: 'Podés pagar con la tuya en el formulario del súper.',
  otpTitle: 'Código que te pide el súper',
  otpLabel: 'Código',
  otpWaiting: 'Si el súper te pide un código para confirmar, aparece acá.',
  otpLead: 'Ponelo en el formulario del súper antes de que venza.',
  otpExpired: 'Ese código venció. Pedí uno nuevo desde el formulario del súper y esperá acá.',
} as const;

const PRUEBA: CheckoutCopy = {
  ...COMMON,
  // It used to ask them to send the importe themselves. Nobody in this mode
  // has anywhere to send it *from* — that is the whole shape of preview — so
  // the sentence now says who pays, because "es una prueba" alone leaves a
  // reader wondering what they are about to be charged.
  depositTitle: 'Paso 1: el importe',
  depositLead: 'Es una prueba y la ponemos nosotros: tocá el botón y seguimos.',
  demoPayCta: 'Pagar con nuestra plata',
  demoPayWorking: 'Pagando…',
  demoPayError: 'No pudimos hacer el pago de prueba. Probá de nuevo.',
  // Per basket here, and it really does close with the window.
  cardNote: 'Copiala en el formulario del súper. No la guardamos en ningún lado: cuando cerrás esta ventana, la tarjeta se cierra con ella.',
  cardFunded: 'Tiene justo el importe de esta compra y no se puede usar para otra cosa.',
  refundNote: 'Es una prueba, así que no se mueve plata real.',
  failed: 'Algo salió mal. Como es una prueba, no hay nada que devolver.',
};

const REAL: CheckoutCopy = {
  ...COMMON,
  depositTitle: 'Paso 1: mandá el importe',
  depositLead: 'Mandá este importe a esta dirección, con este código, desde donde tengas tus USDC.',
  cardAgainLead: 'Es la misma de siempre: le sumamos el importe de esta compra y seguís con ella.',
  cardAgainCta: 'Usar mi tarjeta',
  // Not "se cierra con la ventana": this one does not. The numbers still live
  // nowhere — they are asked for again each time the card is shown — and that
  // is the promise this sentence has to keep without overclaiming the rest.
  cardNote: 'Copiala en el formulario del súper. No la guardamos en ningún lado: cada vez que la necesites te la mostramos de nuevo.',
  // The balance, not the basket. A kept card can carry change from the last
  // shop, so "justo el importe de esta compra" would be wrong about the one
  // number the shopper is looking at.
  cardFunded: 'Ese es el saldo que tiene ahora, y solo sirve para el súper.',
  // No automated outbound payment exists, and none is going to be implied.
  refundNote: 'Si algo sale mal, te devolvemos el importe a mano. No es automático.',
  failed: 'No pudimos completar la compra. Escribinos y te devolvemos el importe a mano.',
};

export const CHECKOUT_MODES = [PRUEBA, REAL] as const;

export function checkoutCopy(net: NetworkId): CheckoutCopy {
  return net === 'mainnet' ? REAL : PRUEBA;
}
