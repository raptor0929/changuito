import { setupRef } from '../onboarding.js';
import { forgetSecret, log, registerSecret } from '../secure/redact.js';
import {
  type Bin,
  type Card,
  type CardDetails,
  type DepositAddress,
  type ThreeDsChallenge,
  type Transaction,
  type UsdCents,
  VyrionError,
  type WalletBalance,
} from './types.js';

const DEFAULT_BASE = 'https://vyrioncard.com/api/v1';

/** Documented card funding bounds. Enforced client-side so we fail before the request. */
export const CARD_MIN_CENTS: UsdCents = 100;
export const CARD_MAX_CENTS: UsdCents = 500_000;

/** USD float from the API -> integer cents. */
export const toCents = (usd: number): UsdCents => Math.round(usd * 100);
/** Integer cents -> the USD float the API expects. */
export const toUsd = (cents: UsdCents): number => Math.round(cents) / 100;
export const formatUsd = (cents: UsdCents): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(toUsd(cents));

export interface VyrionConfig {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Live keys are refused unless this is true. The guard exists because
   * `sk_live_` spends real money and the only thing distinguishing it from the
   * sandbox key is four characters in an env var.
   */
  allowLive?: boolean;
}

export class VyrionClient {
  private readonly base: string;
  private readonly key: string;
  private readonly fetch: typeof fetch;
  readonly isLive: boolean;

  constructor(cfg: VyrionConfig) {
    if (!cfg.apiKey) {
      throw new Error(`VYRION_API_KEY is not set. ${setupRef('Vyrion')}`);
    }
    this.isLive = cfg.apiKey.startsWith('sk_live_');
    if (this.isLive && !cfg.allowLive) {
      throw new Error(
        'Refusing to use a live Vyrion key (sk_live_) without ALLOW_LIVE=1. ' +
          'Use a sandbox key (sk_test_) until you mean to spend real money.',
      );
    }
    if (!this.isLive && !cfg.apiKey.startsWith('sk_test_')) {
      log('[vyrion] warning: API key has neither sk_test_ nor sk_live_ prefix.');
    }

    // So the key can never appear in a log line or an error message.
    registerSecret(cfg.apiKey, 'apikey');

    this.key = cfg.apiKey;
    this.base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    const res = await this.fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new VyrionError(
        `Vyrion returned a non-JSON body (HTTP ${res.status}) for ${method} ${path}`,
        res.status,
      );
    }

    if (!res.ok) {
      const e = json as { error?: { code?: string; message?: string }; message?: string };
      throw new VyrionError(
        e?.error?.message ?? e?.message ?? `HTTP ${res.status} from Vyrion`,
        res.status,
        e?.error?.code,
      );
    }
    return json as T;
  }

  // ---- wallet -------------------------------------------------------------

  async walletBalance(): Promise<{ settled: UsdCents; pending: UsdCents; raw: WalletBalance }> {
    const raw = await this.call<WalletBalance>('GET', '/wallet/balance');
    return {
      settled: toCents(raw.balance ?? 0),
      // Surfaced for display only. Nothing in the funding decision may read it.
      pending: toCents(raw.pending_deposits ?? 0),
      raw,
    };
  }

  async depositAddress(currency: 'btc' | 'eth' | 'sol' | 'usdt'): Promise<DepositAddress> {
    const out = await this.call<DepositAddress | DepositAddress[] | { addresses: DepositAddress[] }>(
      'GET',
      '/wallet/deposit-address',
      undefined,
      { currency },
    );
    // The endpoint returns one address when filtered and a collection when not;
    // accept either shape rather than depending on which the account returns.
    const list = Array.isArray(out)
      ? out
      : 'addresses' in out && Array.isArray(out.addresses)
        ? out.addresses
        : [out as DepositAddress];
    const hit = list.find((a) => a?.currency?.toLowerCase() === currency) ?? list[0];
    if (!hit?.address) throw new VyrionError(`No ${currency} deposit address returned`, 200);
    return hit;
  }

  // ---- BINs ---------------------------------------------------------------

  /**
   * BINs ranked best-first: 3DS-capable only, then by acceptance rate.
   * On a decline we walk down this list rather than re-planning.
   */
  async bins(): Promise<Bin[]> {
    const out = await this.call<Bin[] | { bins: Bin[]; data?: Bin[] }>('GET', '/bins');
    const list = Array.isArray(out) ? out : (out.bins ?? out.data ?? []);
    return list
      .filter((b) => b['3ds'] !== false)
      .sort((a, b) => normalizeRate(b.acceptance_rate) - normalizeRate(a.acceptance_rate));
  }

  // ---- cards --------------------------------------------------------------

  async createCard(opts: {
    binId: string;
    amountCents: UsdCents;
    label?: string;
    spendingLimitCents?: UsdCents;
    allowedCategories?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<Card> {
    assertFundable(opts.amountCents);
    return this.call<Card>('POST', '/cards', {
      bin_id: opts.binId,
      amount: toUsd(opts.amountCents),
      ...(opts.label ? { label: opts.label.slice(0, 64) } : {}),
      ...(opts.spendingLimitCents !== undefined
        ? { spending_limit: toUsd(opts.spendingLimitCents) }
        : {}),
      ...(opts.allowedCategories?.length ? { allowed_categories: opts.allowedCategories } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    });
  }

  async fundCard(cardId: string, amountCents: UsdCents): Promise<Card> {
    assertFundable(amountCents);
    return this.call<Card>('POST', `/cards/${cardId}/fund`, { amount: toUsd(amountCents) });
  }

  getCard(cardId: string): Promise<Card> {
    return this.call<Card>('GET', `/cards/${cardId}`);
  }

  /**
   * PAN, CVV and expiry. Rate limited to 30/min by Vyrion.
   *
   * Every sensitive field is registered with the redactor before this returns,
   * so that even if the caller does something careless with it, it cannot reach
   * a log line. Call `forgetCardDetails` when the payment step ends.
   */
  async cardDetails(cardId: string): Promise<CardDetails> {
    const d = await this.call<CardDetails>('GET', `/cards/${cardId}/details`);
    registerSecret(d.pan, 'pan');
    registerSecret(d.cvv, 'cvv');
    if (d.pan) registerSecret(d.pan.replace(/\D/g, ''), 'pan');
    return d;
  }

  freezeCard(cardId: string): Promise<Card> {
    return this.call<Card>('POST', `/cards/${cardId}/freeze`);
  }

  /** Irreversible. Any remaining balance returns to the wallet immediately. */
  terminateCard(cardId: string): Promise<{ id: string; status: CardStatusLike }> {
    return this.call<{ id: string; status: CardStatusLike }>('DELETE', `/cards/${cardId}`);
  }

  // ---- 3DS + transactions -------------------------------------------------

  /** Pending 3DS challenges, OTP included. Codes expire in about three minutes. */
  async threeDsChallenges(cardId?: string): Promise<ThreeDsChallenge[]> {
    const out = await this.call<ThreeDsChallenge[] | { challenges?: ThreeDsChallenge[]; data?: ThreeDsChallenge[] }>(
      'GET',
      '/3ds',
    );
    const list = Array.isArray(out) ? out : (out.challenges ?? out.data ?? []);
    const filtered = cardId ? list.filter((c) => c.card_id === cardId) : list;
    for (const c of filtered) registerSecret(c.otp, 'otp');
    return filtered;
  }

  async transactions(opts: { cardId?: string; type?: Transaction['type'] } = {}): Promise<Transaction[]> {
    const out = await this.call<Transaction[] | { transactions?: Transaction[]; data?: Transaction[] }>(
      'GET',
      '/transactions',
      undefined,
      { card_id: opts.cardId, type: opts.type },
    );
    return Array.isArray(out) ? out : (out.transactions ?? out.data ?? []);
  }
}

type CardStatusLike = string;

/** Drop a card's secrets from the redactor once the payment step is over. */
export function forgetCardDetails(d: CardDetails | undefined): void {
  if (!d) return;
  forgetSecret(d.pan);
  forgetSecret(d.cvv);
  if (d.pan) forgetSecret(d.pan.replace(/\D/g, ''));
}

function assertFundable(cents: UsdCents): void {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new Error(`Funding amount must be an integer number of cents, got ${cents}`);
  }
  if (cents < CARD_MIN_CENTS) {
    throw new Error(`Vyrion's minimum card funding is ${formatUsd(CARD_MIN_CENTS)}; asked for ${formatUsd(cents)}.`);
  }
  if (cents > CARD_MAX_CENTS) {
    throw new Error(`Vyrion's maximum card funding is ${formatUsd(CARD_MAX_CENTS)}; asked for ${formatUsd(cents)}.`);
  }
}

/** Accepts acceptance_rate as either 0..1 or 0..100 and returns 0..1. */
function normalizeRate(r: number | undefined): number {
  if (r == null || !Number.isFinite(r)) return 0;
  return r > 1 ? r / 100 : r;
}
