import type { Centavos, Money } from '../types.js';

/**
 * Argentine supermarket APIs are inconsistent about money and it is the easiest
 * way to be wrong by 100x. Observed on real responses:
 *
 *   Checkout API (orderForm, simulation)   sellingPrice: 315000   -> integer centavos
 *   Intelligent Search commertialOffer     Price: 3150.0          -> float pesos
 *   Intelligent Search commertialOffer     ListPrice: 315000.0    -> float centavos (!)
 *   Intelligent Search priceRange          sellingPrice 2915 / listPrice 291500 in the
 *                                          same object, different units
 *
 * So we never infer units. Each call site states what it is handing us.
 */
export const fromCentavos = (c: number): Money => ({
  centavos: Math.round(c),
  display: formatARS(Math.round(c)),
});

export const fromPesos = (p: number): Money => fromCentavos(Math.round(p * 100));

const arsFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

export function formatARS(centavos: Centavos): string {
  return arsFormatter.format(centavos / 100);
}

export const addMoney = (...m: Money[]): Money =>
  fromCentavos(m.reduce((s, x) => s + x.centavos, 0));

/**
 * Parse an amount the user typed back at us, in pesos, into centavos.
 *
 * This is the approval gate's input, so it is deliberately strict and
 * deliberately fails rather than guesses: a misparse aborts the payment, which
 * is the safe direction. Accepts what a person actually types — `$ 12.345,67`,
 * `12345,67`, `12345.67`, `ARS 12345` — and refuses anything else.
 *
 * Separator rules follow es-AR: a comma is always the decimal mark; a lone dot
 * is a decimal mark only when one or two digits follow it, otherwise it is a
 * thousands separator, because `12.345` in Argentina means twelve thousand.
 */
export function parseARS(input: string): Centavos {
  const raw = String(input)
    .replace(/ars|\$| |\s/gi, '')
    .trim();
  if (!raw || !/^-?[\d.,]+$/.test(raw)) {
    throw new Error(`"${input}" is not an amount I can read. Write it like 12345,67 or 12345.67.`);
  }

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0) {
    // Comma decides: everything before it is grouping, everything after is cents.
    normalized = raw.slice(0, lastComma).replace(/[.,]/g, '') + '.' + raw.slice(lastComma + 1);
  } else if (lastDot >= 0 && raw.length - lastDot - 1 <= 2 && raw.indexOf('.') === lastDot) {
    normalized = raw;
  } else {
    normalized = raw.replace(/\./g, '');
  }

  const pesos = Number(normalized);
  if (!Number.isFinite(pesos)) {
    throw new Error(`"${input}" is not an amount I can read. Write it like 12345,67 or 12345.67.`);
  }
  return Math.round(pesos * 100);
}
