/**
 * Why a checkout did not go through, in words the shopper can act on.
 *
 * Two places used to say only "something failed": `open`, whose 502 hid a
 * simulation log that said exactly what was wrong ("Transfer: insufficient
 * lamports"), and the refund, which said "No pudimos completar el pago en
 * Día" whether the card was declined, the form was not found or Día asked for
 * a reCAPTCHA. The cause was in the logs and nowhere the shopper could see it.
 *
 * These map our own signals — the program logs, the sandbox's
 * `payment_detail` (written by services/sandbox/checkout.py, not by Día) and
 * the phase it stopped in — to a sentence. Never the store's raw text: a
 * decline message from Día is not repeated, only the fact of it. Pure, so the
 * mapping is testable.
 */

/** Every string an error carries that might hold a program log. */
function texts(err: unknown): string {
  const out: string[] = [];
  const walk = (e: unknown, depth: number) => {
    if (!e || depth > 4) return;
    if (typeof e === 'string') return void out.push(e);
    if (e instanceof Error) out.push(e.message);
    if (typeof e === 'object') {
      const o = e as { context?: { logs?: unknown }; logs?: unknown; cause?: unknown };
      for (const logs of [o.context?.logs, o.logs]) if (Array.isArray(logs)) out.push(...logs.map(String));
      walk(o.cause, depth + 1);
    }
  };
  walk(err, 0);
  return out.join('\n');
}

/** For a failed `open`: what to tell the shopper. */
export function openFailureMessage(err: unknown): string {
  const t = texts(err);
  if (/insufficient lamports/i.test(t)) {
    return 'Tu billetera no tiene SOL suficiente para abrir el pedido. Cargá USDC de prueba arriba y volvé a intentar.';
  }
  if (/insufficient funds/i.test(t)) return 'No te alcanza el USDC para bloquear este pedido.';
  if (/blockhash not found|block height exceeded|expired/i.test(t)) {
    return 'La firma tardó demasiado y la transacción venció. Probá de nuevo.';
  }
  if (/already in use/i.test(t)) return 'Ese pedido ya está abierto.';
  return 'No pudimos bloquear el pago. Probá de nuevo.';
}

const PHASE: Record<string, string> = {
  queued: 'antes de empezar',
  login: 'al entrar a tu cuenta de Día',
  empty_cart: 'al vaciar el carrito de Día',
  shop: 'al cargar los productos',
  checkout: 'en la caja de Día',
  payment: 'en el pago',
};

/** For a refund: why the USDC went back. */
export function refundReason(r: {
  status: string;
  payment: string;
  mode?: string;
  detail?: string | null;
  phase?: string | null;
}): string {
  if (r.mode === 'demo') return 'Modo prueba: la compra de prueba no llegó al pago.';
  const d = r.detail ?? '';
  if (r.payment === 'declined') return 'Día rechazó el pago con tarjeta.';
  if (/403 on \/transaction|CHK0082|recaptcha/i.test(d)) {
    return 'Día pidió una verificación (reCAPTCHA) antes de cobrar y la compra automática no puede resolverla.';
  }
  if (/no card|shared_card/i.test(d)) return 'No hay una tarjeta configurada para pagar.';
  if (/card form|filling the card|pay button/i.test(d)) return 'No pudimos completar el formulario de pago de Día.';
  if (/no answer from the store/i.test(d)) return 'Día no respondió después de pagar.';
  if (r.payment === 'not_attempted' && r.status === 'done') return 'La compra llegó al pago pero no se intentó pagar.';
  if (r.payment === 'error') return 'No pudimos completar el pago en Día.';
  const where = r.phase ? PHASE[r.phase] : undefined;
  return where ? `La compra se frenó ${where}.` : 'La compra no llegó al pago en Día.';
}
