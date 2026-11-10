import type { Lang } from '../lang.ts';

/** The escrow checkout's words. Nothing here is estimated: every line reports something that happened. */
export interface EscrowCopy {
  title: string;
  steps: [string, string, string];
  loginLead: string;
  loginCta: string;
  preparing: string;
  subtotalLabel: string;
  shippingLabel: string;
  totalLabel: string;
  rateLabel: string;
  lockLabel: string;
  rateNote: (source: string) => string;
  diaTitle: string;
  diaLead: string;
  emailLabel: string;
  passwordLabel: string;
  dniLabel: string;
  addressMore: string;
  streetLabel: string;
  numberLabel: string;
  phoneLabel: string;
  diaMissing: string;
  profileUsing: (email: string) => string;
  profileOther: string;
  /** Saves the Día login to the profile (encrypted) before anything is locked. */
  diaSaveCta: string;
  diaSaving: string;
  /** The run for a wallet that may not pay with our card: stops at payment, then settles or refunds. */
  demoNote: string;
  demoPayment: string;
  demoShoppingNote: string;
  demoDoneTitle: string;
  demoDoneLead: string;
  /** A demo that failed before payment, which still refunds. */
  demoRefundedLead: string;
  /** The receipt's amount for a finished demo: nothing was charged. */
  demoPaid: (amount: string) => string;
  postalNote: (profile: string, chat: string) => string;
  escrowNote: string;
  balanceLabel: string;
  short: string;
  faucetCta: string;
  faucetWorking: string;
  lockCta: (amount: string) => string;
  locking: string;
  lockedNote: string;
  phases: Record<string, string>;
  shoppingNote: string;
  doneTitle: string;
  doneLead: (orderId: string | null) => string;
  openStore: string;
  doneNote: string;
  refundedTitle: string;
  refundedLead: string;
  /** Before the refund's cause. */
  causeLabel: string;
  declinedLead: string;
  lockTx: string;
  settleTx: string;
  refundTx: string;
  close: string;
  finish: string;
  failed: string;
  /** While the order is still open and something is off (lib/checkout/resolver-alert.ts). */
  alertTitle: Record<'resolver_failed' | 'stuck', string>;
  alertBody: Record<'resolver_failed' | 'stuck', string>;
}

const ES: EscrowCopy = {
  title: 'Confirmar la compra',
  steps: ['Entrar', 'Confirmar y bloquear', 'Comprar'],
  loginLead: 'Entrá con tu email. Te creamos una billetera de prueba y nosotros pagamos las comisiones.',
  loginCta: 'Entrar con email',
  preparing: 'Preparando el pedido…',
  subtotalLabel: 'Productos',
  shippingLabel: 'Envío',
  totalLabel: 'Total en Día',
  rateLabel: 'Cotización',
  lockLabel: 'Se bloquean',
  rateNote: (source) => `Cotización ${source} del momento. El envío es el que cobra Día a tu código postal.`,
  diaTitle: 'Tu cuenta de Día',
  diaLead:
    'Compramos en tu cuenta, así el pedido es tuyo y llega a tu dirección guardada. Los guardamos cifrados en tu perfil y solo los usamos para hacer tus pedidos.',
  emailLabel: 'Email',
  passwordLabel: 'Contraseña',
  dniLabel: 'DNI',
  addressMore: '¿Tu cuenta de Día no tiene una dirección guardada?',
  streetLabel: 'Calle',
  numberLabel: 'Número',
  phoneLabel: 'Teléfono',
  diaMissing: 'Completá email, contraseña y DNI de tu cuenta de Día.',
  profileUsing: (email) => `Compramos con los datos de tu perfil${email ? ` (${email})` : ''}.`,
  profileOther: 'Editar mis datos de Día',
  diaSaveCta: 'Guardar y seguir',
  diaSaving: 'Guardando…',
  demoNote:
    'Modo prueba: hacemos la compra con tu changuito hasta el pago y te cobramos los USDC de prueba. No se paga nada en Día.',
  demoPayment: 'Llegamos al pago. En modo prueba no pagamos…',
  demoShoppingNote: 'Estamos recorriendo la compra paso a paso. Tarda unos segundos.',
  demoDoneTitle: 'Llegamos hasta el pago',
  demoDoneLead: 'Cobramos tus USDC de prueba. Como es una prueba, el pedido no se paga en Día.',
  demoRefundedLead: 'No llegamos al pago. Tus USDC volvieron a tu saldo.',
  demoPaid: (amount) => `${amount} USDC de prueba`,
  postalNote: (profile, chat) => `Enviamos a tu código postal ${profile}, el de tu perfil. Los precios del chat eran para ${chat}.`,
  escrowNote:
    'La plata queda en un escrow, no con nosotros. Si la compra no llega al pago, vuelve a tu billetera sola.',
  balanceLabel: 'Tu saldo',
  short: 'No te alcanza. Cargá USDC de prueba para seguir.',
  faucetCta: 'Cargar 50 USDC de prueba',
  faucetWorking: 'Cargando…',
  lockCta: (amount) => `Bloquear ${amount} USDC y comprar`,
  locking: 'Firmando en tu billetera…',
  lockedNote: 'USDC bloqueado en el escrow.',
  phases: {
    queued: 'En la fila para comprar…',
    login: 'Entrando a Día…',
    empty_cart: 'Vaciando el carrito de Día…',
    shop: 'Cargando los productos en Día…',
    checkout: 'Eligiendo envío y pasando por la caja…',
    payment: 'Pagando con tarjeta…',
    placed: 'Pedido hecho.',
  },
  shoppingNote: 'Un navegador en la nube está armando y pagando tu pedido en Día. Tarda un par de minutos.',
  doneTitle: '¡Compra completada!',
  doneLead: (id) => (id ? `Día aceptó tu pedido n.º ${id} y el escrow se liberó.` : 'Día aceptó tu pedido y el escrow se liberó.'),
  openStore: 'Abrir en Día',
  doneNote: 'Lo ves en "Mis pedidos" de tu cuenta de Día.',
  refundedTitle: 'No pudimos completar la compra',
  refundedLead: 'El escrow devolvió tus USDC a tu billetera.',
  causeLabel: 'Motivo:',
  declinedLead: 'Día rechazó el pago con tarjeta. El escrow devolvió tus USDC a tu billetera.',
  lockTx: 'Bloqueo',
  settleTx: 'Liberación',
  refundTx: 'Devolución',
  close: 'Cerrar',
  finish: 'Listo',
  failed: 'Algo falló. Probá de nuevo.',
  alertTitle: {
    resolver_failed: 'Estamos trabados cerrando tu pedido',
    stuck: 'Esto está tardando más de la cuenta',
  },
  alertBody: {
    resolver_failed:
      'La compra terminó, pero no pudimos liberar o devolver el escrow. Lo seguimos intentando solo y ya nos llegó el aviso. Tus USDC siguen bloqueados, no se pierden: si no se resuelve, vuelven a tu billetera cuando vence el pedido (1 hora).',
    stuck:
      'La compra lleva más de 15 minutos sin terminar. Tus USDC siguen seguros en el escrow y nos llegó el aviso. Podés cerrar esta ventana: si no se resuelve, vuelven a tu billetera cuando vence el pedido (1 hora).',
  },
};

const EN: EscrowCopy = {
  title: 'Confirm the purchase',
  steps: ['Sign in', 'Confirm and lock', 'Shop'],
  loginLead: 'Sign in with your email. We create a test wallet for you and cover the fees.',
  loginCta: 'Sign in with email',
  preparing: 'Preparing the order…',
  subtotalLabel: 'Products',
  shippingLabel: 'Delivery',
  totalLabel: 'Total at Día',
  rateLabel: 'Rate',
  lockLabel: 'To lock',
  rateNote: (source) => `Live ${source} rate. Delivery is what Día charges to your postal code.`,
  diaTitle: 'Your Día account',
  diaLead:
    'We buy in your account, so the order is yours and goes to your saved address. We keep them encrypted in your profile and use them only to place your orders.',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  dniLabel: 'DNI',
  addressMore: 'No address saved in your Día account?',
  streetLabel: 'Street',
  numberLabel: 'Number',
  phoneLabel: 'Phone',
  diaMissing: 'Fill in your Día email, password and DNI.',
  profileUsing: (email) => `We'll buy with your profile details${email ? ` (${email})` : ''}.`,
  profileOther: 'Edit my Día details',
  diaSaveCta: 'Save and continue',
  diaSaving: 'Saving…',
  demoNote: 'Test mode: we run the purchase with your basket up to payment and charge your test USDC. Nothing is paid at Día.',
  demoPayment: "We reached payment. In test mode we don't pay…",
  demoShoppingNote: "We're walking through the purchase step by step. It takes a few seconds.",
  demoDoneTitle: 'We reached payment',
  demoDoneLead: "We charged your test USDC. Since it's a test, the order isn't paid at Día.",
  demoRefundedLead: "We didn't reach payment. Your USDC is back in your balance.",
  demoPaid: (amount) => `${amount} test USDC`,
  postalNote: (profile, chat) => `We deliver to ${profile}, your profile's postal code. Chat prices were for ${chat}.`,
  escrowNote:
    "The money sits in an escrow, not with us. If the purchase doesn't reach payment, it goes back to your wallet on its own.",
  balanceLabel: 'Your balance',
  short: "Not enough. Load test USDC to continue.",
  faucetCta: 'Load 50 test USDC',
  faucetWorking: 'Loading…',
  lockCta: (amount) => `Lock ${amount} USDC and shop`,
  locking: 'Signing in your wallet…',
  lockedNote: 'USDC locked in the escrow.',
  phases: {
    queued: 'Waiting in line to shop…',
    login: 'Signing in to Día…',
    empty_cart: "Emptying Día's cart…",
    shop: 'Adding the products at Día…',
    checkout: 'Choosing delivery and going through checkout…',
    payment: 'Paying by card…',
    placed: 'Order placed.',
  },
  shoppingNote: 'A browser in the cloud is building and paying for your order at Día. It takes a couple of minutes.',
  doneTitle: 'Purchase completed!',
  doneLead: (id) => (id ? `Día accepted order #${id} and the escrow was released.` : 'Día accepted your order and the escrow was released.'),
  openStore: 'Open in Día',
  doneNote: 'You can see it under "My orders" in your Día account.',
  refundedTitle: "We couldn't complete the purchase",
  refundedLead: 'The escrow returned your USDC to your wallet.',
  causeLabel: 'Reason:',
  declinedLead: 'Día declined the card payment. The escrow returned your USDC to your wallet.',
  lockTx: 'Lock',
  settleTx: 'Release',
  refundTx: 'Refund',
  close: 'Close',
  finish: 'Done',
  failed: 'Something failed. Try again.',
  alertTitle: {
    resolver_failed: "We're stuck closing your order",
    stuck: 'This is taking longer than it should',
  },
  alertBody: {
    resolver_failed:
      "The purchase finished, but we couldn't release or refund the escrow. We keep retrying on our own and we've been alerted. Your USDC is still locked, not lost: if this doesn't clear, it goes back to your wallet when the order expires (1 hour).",
    stuck:
      "The purchase has been running for over 15 minutes. Your USDC is safe in the escrow and we've been alerted. You can close this window: if it doesn't clear, it goes back to your wallet when the order expires (1 hour).",
  },
};

export function escrowCopy(lang: Lang): EscrowCopy {
  return lang === 'en' ? EN : ES;
}
