import { log } from '../secure/redact.js';
import { forgetCardDetails, formatUsd, type VyrionClient } from './vyrion.js';
import type { Card, CardDetails, ThreeDsChallenge, UsdCents } from './types.js';

/**
 * One card, one basket, then gone.
 *
 * Four independent ceilings, each of which alone would bound the damage:
 *   1. funded with the order total plus the FX buffer and nothing more,
 *   2. `spending_limit` set to exactly that, so the buffer cannot be spent,
 *   3. `allowed_categories` whitelisted to grocery MCCs,
 *   4. terminated as soon as the order is placed, returning the residual.
 *
 * The details (PAN, CVV) live in this object for the seconds between the
 * payment form appearing and the card being typed, and are dropped from the
 * redactor's registry on `terminate`. They are never returned through MCP,
 * never logged, never written down.
 */

export interface EphemeralCardOptions {
  client: VyrionClient;
  binId: string;
  amountCents: UsdCents;
  label?: string;
  allowedCategories?: string[];
  metadata?: Record<string, unknown>;
}

/** How long to wait for the bank's one-time code. Vyrion expires them at ~3 min. */
export const OTP_TIMEOUT_MS = 150_000;
export const OTP_POLL_MS = 3_000;

export class EphemeralCard {
  private details?: CardDetails;
  private terminated = false;
  /** Challenges already used, so a stale code is never typed twice. */
  private readonly seen = new Set<string>();

  private constructor(
    private readonly client: VyrionClient,
    readonly card: Card,
    readonly fundedCents: UsdCents,
  ) {}

  static async create(o: EphemeralCardOptions): Promise<EphemeralCard> {
    const card = await o.client.createCard({
      binId: o.binId,
      amountCents: o.amountCents,
      label: o.label ?? 'grocery order',
      // Equal to the funded amount: the FX buffer is float, not spend.
      spendingLimitCents: o.amountCents,
      allowedCategories: o.allowedCategories,
      metadata: o.metadata,
    });
    log(
      `[card] created ${card.network} ••••${card.last4} funded ${formatUsd(o.amountCents)}, ` +
        `limit ${formatUsd(o.amountCents)}, categories ${(o.allowedCategories ?? ['any']).join('/')}`,
    );
    return new EphemeralCard(o.client, card, o.amountCents);
  }

  get id(): string {
    return this.card.id;
  }

  get last4(): string {
    return this.card.last4;
  }

  /** Fetched once and cached for the fill; the API rate-limits this endpoint. */
  async cardDetails(): Promise<CardDetails> {
    if (this.terminated) throw new Error('This card has already been terminated.');
    this.details ??= await this.client.cardDetails(this.card.id);
    return this.details;
  }

  /**
   * Wait for a 3DS code. The race is real — the code is valid for about three
   * minutes and the page must already be sitting on the challenge — so this
   * polls rather than asking once, and gives up cleanly instead of hanging.
   */
  async otp(opts: { timeoutMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<string | undefined> {
    const timeoutMs = opts.timeoutMs ?? OTP_TIMEOUT_MS;
    const pollMs = opts.pollMs ?? OTP_POLL_MS;
    const now = opts.now ?? Date.now;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const fresh = this.pickChallenge(await this.client.threeDsChallenges(this.card.id).catch(() => []));
      if (fresh) {
        this.seen.add(fresh.id);
        log(`[card] 3DS code received for ${fresh.merchant || 'the merchant'}`);
        return fresh.otp;
      }
      await sleep(pollMs);
    }
    log('[card] no 3DS code arrived before the timeout');
    return undefined;
  }

  /** Newest unused challenge that has not expired. */
  private pickChallenge(list: ThreeDsChallenge[]): ThreeDsChallenge | undefined {
    const usable = list
      .filter((c) => c.otp && !this.seen.has(c.id))
      .filter((c) => !c.expires_at || Date.parse(c.expires_at) > Date.now())
      .filter((c) => !c.status || !/used|expired|cancel/i.test(c.status));
    return usable.sort((a, b) => (a.expires_at ?? '').localeCompare(b.expires_at ?? '')).at(-1);
  }

  /** Stop the card accepting anything else, without destroying it. */
  async freeze(): Promise<void> {
    await this.client.freezeCard(this.card.id).catch((e) => log(`[card] freeze failed: ${e.message}`));
  }

  /**
   * Irreversible, and always worth doing: the residual returns to the wallet
   * immediately. Safe to call twice and safe to call after a failure — which is
   * why every caller puts it in a `finally`.
   */
  async terminate(): Promise<void> {
    forgetCardDetails(this.details);
    this.details = undefined;
    if (this.terminated) return;
    this.terminated = true;
    try {
      await this.client.terminateCard(this.card.id);
      log(`[card] terminated ••••${this.card.last4}; any residual is back in the wallet`);
    } catch (e) {
      // Worth shouting about: an un-terminated card still holds money.
      log(
        `[card] COULD NOT TERMINATE ••••${this.card.last4} (${(e as Error).message}). ` +
          `Terminate it by hand in the Vyrion dashboard — it still holds up to ${formatUsd(this.fundedCents)}.`,
      );
    }
  }
}
