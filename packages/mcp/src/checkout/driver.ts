import type { Page } from 'playwright';

import type { AppConfig } from '../config.js';
import type { CardDetails } from '../pay/types.js';
import { log } from '../secure/redact.js';
import type { DeliveryAddress } from '../types.js';
import { fetchOrderForm } from './cart.js';
import { classifyWithJev } from './classify/jev.js';
import { escalateFromPage, type EscalationReason } from './classify/escalate.js';
import { fillAddress, fillCard, findThreeDs, selectCreditCard, submitOtp, submitPayment } from './dia.js';
import type { FlowDriver, Observation } from './flow.js';
import { readPageState } from './pagestate.js';
import type { Action } from './states.js';
import type { Escalation, Verdict } from './types.js';

/**
 * The only implementation of FlowDriver that touches a browser.
 *
 * Everything decision-shaped lives in flow.ts and states.ts, which are tested
 * with a fake driver. This file is the thin, deliberately boring layer that
 * turns a planned Action into clicks — kept boring precisely because it is the
 * part that cannot be unit-tested without a browser.
 */

export interface PaymentSource {
  /** Fetched at the moment it is needed, never held longer than the fill. */
  cardDetails(): Promise<CardDetails>;
  /** Read from the user's own store profile, not from the card. */
  holderName: string;
  document?: string;
  /** Polls Vyrion for the one-time code. Undefined when it never arrives. */
  otp(): Promise<string | undefined>;
}

export interface LiveDriverOptions {
  page: Page;
  cfg: AppConfig;
  orderFormId?: string;
  address?: DeliveryAddress;
  /**
   * Absent on a dry run and on the drive to the payment form: without it the
   * driver cannot type a card, which is the point.
   */
  payment?: PaymentSource;
}

export class LiveDriver implements FlowDriver {
  readonly classifyJev?: (ps: Observation['pageState']) => Promise<Verdict | undefined>;

  constructor(private readonly o: LiveDriverOptions) {
    if (o.cfg.jev.enabled) {
      this.classifyJev = (ps) => classifyWithJev(o.cfg, ps);
    }
  }

  async observe(): Promise<Observation> {
    const pageState = await readPageState(this.o.page);
    // The orderForm is Layer 1's input, and it is read through the page's own
    // cookie jar — same endpoint as the anonymous adapter, as the logged-in
    // user. A failure here is not fatal: Layers 2 and 3 work on the DOM alone.
    let orderForm;
    try {
      orderForm = await fetchOrderForm(this.o.page.request, this.o.cfg, this.o.orderFormId);
    } catch (e) {
      log(`[driver] could not read the orderForm: ${(e as Error).message}`);
    }
    return { pageState, orderForm };
  }

  async perform(action: Action): Promise<void> {
    const { page } = this.o;
    switch (action.kind) {
      case 'click': {
        await page
          .getByRole('button', { name: action.label, exact: false })
          .first()
          .click({ timeout: 8_000 })
          .catch(async () => {
            // Some VTEX controls are anchors or divs with a button role absent.
            await page.getByText(action.label, { exact: false }).first().click({ timeout: 8_000 });
          });
        await settle(page);
        return;
      }

      case 'fill_address': {
        if (!this.o.address) throw new Error('fill_address was planned with no address held.');
        const r = await fillAddress(page, this.o.address);
        log(`[driver] address: filled ${r.filled.join(', ') || 'nothing'}`);
        if (r.missing.length) log(`[driver] address fields not found: ${r.missing.join(', ')}`);
        await settle(page);
        return;
      }

      case 'fill_payment': {
        const src = this.o.payment;
        if (!src) {
          // The drive to the payment form deliberately runs without a payment
          // source; reaching here means the goal was 'confirmation' and nobody
          // approved a card. Refusing is the only safe answer.
          throw new Error('The payment step was reached without an approved card. Nothing was entered.');
        }
        await selectCreditCard(page);
        const details = await src.cardDetails();
        const r = await fillCard(page, details, src.holderName, src.document);
        if (r.missing.length) {
          throw new Error(`The card form is missing fields I could not find: ${r.missing.join(', ')}`);
        }
        await submitPayment(page);
        await settle(page);
        return;
      }

      case 'submit_otp': {
        const src = this.o.payment;
        if (!src) throw new Error('A 3DS challenge appeared with no card in play.');
        const target = await findThreeDs(page);
        if (target.kind === 'none') {
          log('[driver] a 3DS state was classified but no code field is reachable');
          return;
        }
        log(`[driver] 3DS challenge is ${target.kind}`);
        const otp = await src.otp();
        if (!otp) throw new Error('The bank asked for a one-time code and Vyrion did not produce one in time.');
        await submitOtp(target, otp);
        await settle(page);
        return;
      }

      case 'wait':
        await settle(page);
        return;

      case 'none':
        return;
    }
  }

  async escalate(
    verdict: Verdict | undefined,
    obs: Observation,
    reason: EscalationReason,
    extra?: string,
  ): Promise<Escalation> {
    return escalateFromPage(this.o.page, this.o.cfg, verdict, obs.pageState, reason, extra);
  }

  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return this.o.page.waitForTimeout(ms);
  }
}

/** Let the SPA finish whatever the click started, without failing on a timeout. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
