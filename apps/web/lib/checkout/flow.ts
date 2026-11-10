import type { ManualCheckoutFlow } from '../config.ts';

export type SteppedFlow = 'guided' | 'headless';
export type FlowPart = 'form' | 'screen' | 'all';
export type FlowScreen = 'progress' | 'card' | 'browser' | 'paying' | 'verification' | 'placed' | 'declined';

/**
 * What the viewer route may hand the browser.
 * Headless never includes the remote-browser URL. Guided asks for the card
 * grant and the screen ticket separately, so typing the card does not burn
 * the single-use screen ticket.
 */
export function viewerGrant(flow: ManualCheckoutFlow | undefined, part: FlowPart): {
  purpose: 'card' | 'browser' | 'both';
  browser: boolean;
} {
  if (flow === 'headless') return { purpose: 'card', browser: false };
  if (flow === 'guided' && part === 'form') return { purpose: 'card', browser: false };
  if (flow === 'guided' && part === 'screen') return { purpose: 'browser', browser: true };
  return { purpose: 'both', browser: true };
}

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** The JSON the browser is allowed to see. Headless has a form URL and no remote browser. */
export function viewerBody(
  flow: ManualCheckoutFlow | undefined,
  part: FlowPart,
  result: { ticket?: unknown; cardToken?: unknown; jobId: string; expiresAt: number | null },
  base: string,
): Record<string, unknown> | null {
  const grant = viewerGrant(flow, part);
  const cardToken = typeof result.cardToken === 'string' && TOKEN.test(result.cardToken) ? result.cardToken : '';
  const ticket = typeof result.ticket === 'string' && TOKEN.test(result.ticket) ? result.ticket : '';
  if (grant.browser) {
    if (!ticket) return null;
    const viewerUrl = new URL(flow === 'guided' ? '/viewer/?part=screen' : '/viewer/', base).toString();
    return { viewerUrl, jobId: result.jobId, ticket, ...(cardToken ? { cardToken } : {}), expiresAt: result.expiresAt };
  }
  if (!cardToken) return null;
  return { formUrl: new URL('/viewer/?part=form', base).toString(), jobId: result.jobId, cardToken, expiresAt: result.expiresAt };
}

/** A poll that repeats the phase keeps the same announcement. */
export function announcedPhase(shown: string | null, incoming: string | null): string | null {
  return incoming === shown ? shown : incoming;
}

export function flowLabels(lang: 'es' | 'en', flow: SteppedFlow): string[] {
  if (lang === 'en') {
    return flow === 'headless'
      ? ['Sign in', 'Confirm and lock', 'Preparing', 'Card', 'Paying']
      : ['Sign in', 'Confirm and lock', 'Preparing', 'Card', 'Día session'];
  }
  return flow === 'headless'
    ? ['Entrar', 'Confirmar y bloquear', 'Preparando', 'Tarjeta', 'Pagando']
    : ['Entrar', 'Confirmar y bloquear', 'Preparando', 'Tarjeta', 'Sesión de Día'];
}

export function flowScreen(
  flow: SteppedFlow,
  status: { phase?: string | null; manual?: { preparation?: string; purchase?: string } | null } | null,
  cardSent: boolean,
): FlowScreen {
  const purchase = status?.manual?.purchase ?? 'not_started';
  if (purchase === 'placed') return 'placed';
  if (purchase === 'declined') return 'declined';
  if (purchase === 'verification_required') return 'verification';
  const ready = status?.manual?.preparation === 'ready' && status?.phase === 'payment';
  if (!ready) return 'progress';
  if (!cardSent) return 'card';
  return flow === 'headless' ? 'paying' : 'browser';
}

export function flowRailIndex(step: string, screen: FlowScreen): number {
  if (step === 'login') return 0;
  if (step === 'review' || step === 'locking') return 1;
  if (screen === 'progress') return 2;
  if (screen === 'card') return 3;
  return 4;
}

export interface FlowCopy {
  progressTitle: string;
  cardTitle: string;
  browserTitle: string;
  payingTitle: string;
  paying: string;
  placedTitle: string;
  placed: string;
  declinedTitle: string;
  declined: string;
  verificationTitle: string;
  verification: string;
  formFrame: string;
  browserFrame: (amount: string) => string;
  retry: string;
  cancelPrep: string;
  closeSession: string;
  feeReady: string;
  feeWaiting: string;
  session: string;
  continueToStore: string;
}

const ES: FlowCopy = {
  progressTitle: 'Preparando el pago',
  cardTitle: 'Tu tarjeta',
  browserTitle: 'Sesión de Día',
  payingTitle: 'Pagando',
  paying: 'Estamos pagando en Día. En esta página no hay un navegador.',
  placedTitle: 'Pedido hecho',
  placed: 'Día aceptó el pedido. La comisión de preparación ya estaba cobrada.',
  declinedTitle: 'Día rechazó el pago',
  declined: 'El pedido no se hizo. La comisión de preparación sigue cobrada.',
  verificationTitle: 'No se pudo verificar',
  verification: 'Día no aceptó la verificación. El pedido no se hizo. La comisión de preparación sigue cobrada.',
  formFrame: 'Formulario de la tarjeta',
  browserFrame: (amount) => `Sesión de Día por ${amount}. Revisá el total, el captcha y Finalizar compra.`,
  retry: 'Reintentar preparación',
  cancelPrep: 'Cancelar preparación',
  closeSession: 'Cerrar sesión',
  feeReady: 'La preparación ya generó la comisión de 0,10 USDC de prueba. Abandonar o un rechazo no la devuelve.',
  feeWaiting: 'Si la preparación falla, devolvemos la comisión.',
  session: 'Tiempo restante',
  continueToStore: 'Continuar a Día',
};

const EN: FlowCopy = {
  progressTitle: 'Preparing checkout',
  cardTitle: 'Your card',
  browserTitle: 'Día session',
  payingTitle: 'Paying',
  paying: 'Paying in DIA. There is no browser on this page.',
  placedTitle: 'Order placed',
  placed: 'DIA accepted the order. The preparation fee was already charged.',
  declinedTitle: 'DIA declined the payment',
  declined: 'The order was not placed. The preparation fee stays charged.',
  verificationTitle: 'Verification failed',
  verification: 'DIA did not accept the verification. The order was not placed. The preparation fee stays charged.',
  formFrame: 'Card form',
  browserFrame: (amount) => `Día session for ${amount}. Review the total, the captcha, and Finalizar compra.`,
  retry: 'Retry preparation',
  cancelPrep: 'Cancel preparation',
  closeSession: 'Close session',
  feeReady: 'Preparation already earned the 0.10 test USDC fee. Leaving or a decline does not refund it.',
  feeWaiting: 'If preparation fails, the fee is refunded.',
  session: 'Time remaining',
  continueToStore: 'Continue to Día',
};

export function flowCopy(lang: 'es' | 'en'): FlowCopy {
  return lang === 'en' ? EN : ES;
}
