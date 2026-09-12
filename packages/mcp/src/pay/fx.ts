import type { Centavos } from '../types.js';
import type { UsdCents } from './types.js';

/**
 * Día charges ARS. Vyrion funds cards in USD. So "fund the card with the order
 * total" is a conversion, not a number — and the rate the card network applies
 * at settlement is not the rate we can see at funding time.
 *
 * Hence the buffer: we deliberately overfund, cap the card's spending_limit at
 * exactly what we funded, and terminate the card afterwards so the remainder
 * comes straight back to the wallet. The buffer is float, not spend; it costs
 * nothing and it is what stops a 2% rate move turning into a declined payment
 * at the checkout screen.
 */

export const DEFAULT_BUFFER = 0.15;

/**
 * A bad rate is the most dangerous number in this system: it is the difference
 * between loading $20 and loading $20,000 onto a card. If the upstream feed
 * returns 1, or 0, or a number of pesos per dollar that no Argentine has ever
 * seen, we refuse rather than fund. Wide enough not to need touching as the
 * peso moves, narrow enough to catch a broken response.
 */
export const RATE_MIN = 50;
export const RATE_MAX = 100_000;

const DEFAULT_SOURCE = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 60 * 60 * 1000;

export interface FxRate {
  /** Pesos per dollar. */
  arsPerUsd: number;
  source: string;
  fetchedAt: number;
}

export interface FxOptions {
  fetchImpl?: typeof fetch;
  sourceUrl?: string;
  /** Pin the rate — used by dry runs and tests so results are reproducible. */
  override?: number;
  now?: () => number;
}

let cached: FxRate | undefined;

/** Drop the cached rate. Tests and long-lived sessions. */
export function clearFxCache(): void {
  cached = undefined;
}

export function assertSaneRate(rate: number, source: string): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX source ${source} returned a non-numeric ARS rate (${rate}).`);
  }
  if (rate < RATE_MIN || rate > RATE_MAX) {
    throw new Error(
      `FX source ${source} returned ${rate} ARS/USD, outside the sane range ` +
        `${RATE_MIN}–${RATE_MAX}. Refusing to size a card funding from it. ` +
        'Set ARS_PER_USD to pin the rate manually if this range needs widening.',
    );
  }
  return rate;
}

export async function getArsPerUsd(opts: FxOptions = {}): Promise<FxRate> {
  const now = opts.now ?? Date.now;

  if (opts.override !== undefined) {
    return {
      arsPerUsd: assertSaneRate(opts.override, 'override'),
      source: 'override',
      fetchedAt: now(),
    };
  }

  if (cached && now() - cached.fetchedAt < TTL_MS) return cached;

  const source = opts.sourceUrl ?? DEFAULT_SOURCE;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(source, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`FX source ${source} returned HTTP ${res.status}.`);

  const body = (await res.json()) as { rates?: Record<string, number> };
  const rate = body?.rates?.ARS;
  if (rate === undefined) throw new Error(`FX source ${source} did not include an ARS rate.`);

  cached = { arsPerUsd: assertSaneRate(rate, source), source, fetchedAt: now() };
  return cached;
}

/**
 * Pesos (as integer centavos) -> dollars (as integer cents), with the buffer
 * applied and rounded UP. Rounding up matters: rounding down could leave the
 * card a cent short of the authorisation and produce a decline at the till.
 */
export function arsToUsdCents(
  centavos: Centavos,
  arsPerUsd: number,
  buffer = DEFAULT_BUFFER,
): UsdCents {
  if (!Number.isFinite(centavos) || centavos < 0) {
    throw new Error(`Invalid ARS amount: ${centavos} centavos`);
  }
  if (buffer < 0 || buffer > 1) {
    throw new Error(`FX buffer must be between 0 and 1, got ${buffer}`);
  }
  assertSaneRate(arsPerUsd, 'conversion');
  const usd = (centavos / 100 / arsPerUsd) * (1 + buffer);
  return Math.ceil(usd * 100);
}

/** Dollars back to pesos, for showing the user what a balance is worth. */
export function usdCentsToArs(cents: UsdCents, arsPerUsd: number): Centavos {
  assertSaneRate(arsPerUsd, 'conversion');
  return Math.round((cents / 100) * arsPerUsd * 100);
}
