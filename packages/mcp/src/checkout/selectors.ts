/**
 * Every Día-specific selector in one file.
 *
 * Two rules:
 *
 *  1. LABEL FIRST, CSS LAST. A field is found by what it asks for
 *     ("Número de tarjeta") before it is found by how it is styled. Labels are
 *     user-visible and survive a restyle; class names do not.
 *  2. FALLBACK CHAINS, NOT SINGLE GUESSES. Each entry lists several ways to
 *     reach the same control, tried in order. A store that changes one of them
 *     does not break the run.
 *
 * The file is pure data plus pure matchers so the selectors can be regression-
 * tested against saved page fixtures with no browser (see `matchesField`).
 */

import type { PageState } from './pagestate.js';

export interface FieldSpec {
  id: string;
  /** What the field asks for, as shown to the user. */
  label: RegExp;
  /** Anything matching this is NOT the field, however well the label matches. */
  not?: RegExp;
  /** Last resort, in order. */
  css?: string[];
  /** Whether the flow can continue without it. */
  optional?: boolean;
}

export interface ButtonSpec {
  id: string;
  label: RegExp;
  /** Never press these even when the label matches. */
  avoid?: RegExp;
  css?: string[];
}

// ---- delivery address ------------------------------------------------------

export const ADDRESS_FIELDS: Record<string, FieldSpec> = {
  postalCode: {
    id: 'postalCode',
    label: /c[oó]digo postal|^cp\b|postal/i,
    css: ['input[name*="postalCode" i]', 'input[id*="postal" i]'],
  },
  street: {
    id: 'street',
    label: /calle|direcci[oó]n|domicilio|street/i,
    not: /n[uú]mero|piso|depto|referencia/i,
    css: ['input[name*="street" i]', 'input[id*="street" i]'],
  },
  number: {
    id: 'number',
    label: /n[uú]mero|altura|^nro/i,
    not: /tel[eé]fono|documento|tarjeta/i,
    css: ['input[name*="number" i]:not([name*="card" i])'],
  },
  complement: {
    id: 'complement',
    label: /piso|depto|departamento|complemento|unidad/i,
    css: ['input[name*="complement" i]'],
    optional: true,
  },
  reference: {
    id: 'reference',
    label: /referencia|entre calles|indicaciones/i,
    css: ['input[name*="reference" i]', 'textarea[name*="reference" i]'],
    optional: true,
  },
  city: {
    id: 'city',
    label: /ciudad|localidad|city/i,
    css: ['input[name*="city" i]', 'input[name*="locality" i]'],
    optional: true,
  },
  state: {
    id: 'state',
    label: /provincia|estado|state/i,
    css: ['select[name*="state" i]', 'input[name*="state" i]'],
    optional: true,
  },
  receiverName: {
    id: 'receiverName',
    label: /qui[eé]n recibe|nombre.*recibe|receiver/i,
    css: ['input[name*="receiver" i]'],
    optional: true,
  },
  phone: {
    id: 'phone',
    label: /tel[eé]fono|celular|phone/i,
    css: ['input[name*="phone" i]', 'input[type="tel"]'],
    optional: true,
  },
};

// ---- payment ---------------------------------------------------------------

/**
 * The payment-method choice. You verified Día accepts an international card
 * under "tarjeta de crédito", so that is what we pick — never "débito", which
 * a prepaid BIN will fail, and never a cash or transfer option.
 */
export const CREDIT_CARD_OPTION: ButtonSpec = {
  id: 'credit_card',
  label: /tarjeta de cr[eé]dito|cr[eé]dito|credit card/i,
  avoid: /d[eé]bito|efectivo|transferencia|mercado ?pago|cuenta dni/i,
  css: ['[data-payment-system]', 'label[for*="credit" i]'],
};

export const CARD_FIELDS: Record<string, FieldSpec> = {
  pan: {
    id: 'pan',
    label: /n[uú]mero de (la )?tarjeta|card ?number|numero de tarjeta/i,
    css: ['input[name*="cardNumber" i]', 'input[id*="cardNumber" i]', 'input[autocomplete="cc-number"]'],
  },
  holder: {
    id: 'holder',
    label: /nombre.*(tarjeta|titular)|titular|cardholder|name on card/i,
    css: ['input[name*="holderName" i]', 'input[autocomplete="cc-name"]'],
  },
  expiry: {
    id: 'expiry',
    label: /vencimiento|expira|exp(iry|iration)?|mm ?\/ ?(aa|yy)/i,
    css: ['input[name*="expiration" i]', 'input[autocomplete="cc-exp"]'],
  },
  expiryMonth: {
    id: 'expiryMonth',
    label: /^mes|month/i,
    css: ['select[name*="month" i]', 'input[autocomplete="cc-exp-month"]'],
    optional: true,
  },
  expiryYear: {
    id: 'expiryYear',
    label: /^a[nñ]o|year/i,
    css: ['select[name*="year" i]', 'input[autocomplete="cc-exp-year"]'],
    optional: true,
  },
  cvv: {
    id: 'cvv',
    label: /c[oó]digo de seguridad|cvv|cvc|csc/i,
    css: ['input[name*="securityCode" i]', 'input[autocomplete="cc-csc"]'],
  },
  document: {
    id: 'document',
    label: /dni|documento|cuit|cuil/i,
    css: ['input[name*="document" i]'],
    optional: true,
  },
  installments: {
    id: 'installments',
    label: /cuotas|installment/i,
    css: ['select[name*="installment" i]'],
    optional: true,
  },
};

export const OTP_FIELD: FieldSpec = {
  id: 'otp',
  label: /c[oó]digo|token|otp|clave|verificaci[oó]n|one[- ]?time/i,
  not: /postal|seguridad de la tarjeta/i,
  css: ['input[name*="otp" i]', 'input[name*="code" i]', 'input[inputmode="numeric"]'],
};

// ---- buttons ---------------------------------------------------------------

export const BUTTONS: Record<string, ButtonSpec> = {
  goToCheckout: {
    id: 'goToCheckout',
    label: /finalizar compra|iniciar compra|ir a pagar|continuar al pago/i,
    avoid: /agregar|a[ñn]adir|seguir comprando/i,
  },
  continue: { id: 'continue', label: /continuar|siguiente|continue/i, avoid: /agregar|a[ñn]adir/i },
  confirmAddress: { id: 'confirmAddress', label: /confirmar|es correcta|usar esta/i },
  /**
   * The one that spends money. Isolated deliberately: nothing in the navigation
   * loop may press it — only the payment step, after the user's approval.
   */
  pay: {
    id: 'pay',
    label: /finalizar (la )?compra|pagar|confirmar (el )?pago|realizar (el )?pedido/i,
    avoid: /cancelar|volver/i,
  },
  submitOtp: { id: 'submitOtp', label: /(enviar|validar|confirmar|verificar|continuar)/i, avoid: /reenviar|cancelar/i },
};

// ---- pure matchers, for fixture tests --------------------------------------

/** True when this page state contains a field matching the spec. */
export function matchesField(spec: FieldSpec, ps: PageState): boolean {
  return ps.fields.some((f) => spec.label.test(f.label) && !(spec.not?.test(f.label) ?? false));
}

/** The accessible name of the button on this page, if present and allowed. */
export function matchesButton(spec: ButtonSpec, ps: PageState): string | undefined {
  return ps.buttons.find((b) => spec.label.test(b) && !(spec.avoid?.test(b) ?? false));
}

/** Which required fields of a group are missing from the page. */
export function missingFields(specs: Record<string, FieldSpec>, ps: PageState): string[] {
  return Object.values(specs)
    .filter((s) => !s.optional && !matchesField(s, ps))
    .map((s) => s.id);
}

/** A page that asks for a PAN, an expiry and a CVV is a card form. */
export function looksLikeCardForm(ps: PageState): boolean {
  return (
    matchesField(CARD_FIELDS.pan!, ps) &&
    matchesField(CARD_FIELDS.cvv!, ps) &&
    (matchesField(CARD_FIELDS.expiry!, ps) || matchesField(CARD_FIELDS.expiryMonth!, ps))
  );
}
