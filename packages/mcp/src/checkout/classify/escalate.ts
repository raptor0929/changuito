import type { Page } from 'playwright';

import type { AppConfig } from '../../config.js';
import { log } from '../../secure/redact.js';
import { ArtifactRefused, screenshot } from '../browser.js';
import { type PageState, summarize } from '../pagestate.js';
import { Escalation, type Verdict } from '../types.js';

/**
 * LAYER 4 — ask the user.
 *
 * In a flow that spends money, stopping to ask is a feature. Everything here
 * exists to make that stop useful rather than just a failure: what screen we
 * are on, what we tried, what we would do next, and a picture when taking one
 * is safe.
 */

export type EscalationReason =
  | 'unknown_screen'
  | 'stalled'
  | 'budget_exhausted'
  | 'no_action'
  | 'store_problem'
  | 'total_mismatch'
  | 'vetoed';

const HEADLINE: Record<EscalationReason, string> = {
  unknown_screen: 'I do not recognise this screen, so I stopped instead of clicking something.',
  stalled: 'The page stopped responding to what I was doing.',
  budget_exhausted: 'The checkout took more steps than I am allowed to spend on it.',
  no_action: 'I recognise this screen but cannot find the control that moves it forward.',
  store_problem: 'The store is reporting a problem that changes what you would be paying for.',
  total_mismatch: 'The total on the page is not the total you approved. Nothing was paid.',
  vetoed: 'A safety check refused to let the payment through.',
};

export function buildEscalation(
  verdict: Verdict | undefined,
  pageState: PageState,
  reason: EscalationReason,
  extra?: string,
  screenshotPath?: string,
): Escalation {
  const v: Verdict = verdict ?? {
    state: 'unknown',
    confidence: 0,
    layer: 'escalation',
    why: 'no layer produced a verdict',
  };

  const summary = summarize(pageState);
  const parts = [
    HEADLINE[reason],
    '',
    `What I think it is: ${v.state} (${v.layer}, confidence ${v.confidence})`,
    `Why: ${v.why}`,
  ];
  if (extra) parts.push('', extra);
  if (v.problems?.length) parts.push('', 'The store also said:', ...v.problems.map((p) => `  - ${p}`));
  parts.push('', 'The page:', summary);
  if (screenshotPath) parts.push('', `Screenshot: ${screenshotPath}`);
  parts.push('', 'Nothing has been paid. Tell me what to do and I will carry on from here.');

  return new Escalation(parts.join('\n'), v, screenshotPath, summary);
}

/**
 * Escalate from a live page, attaching a screenshot when one is allowed.
 * During the payment window it is not allowed, and that refusal must not turn
 * an escalation into a crash — so it is caught and noted.
 */
export async function escalateFromPage(
  page: Page,
  cfg: AppConfig,
  verdict: Verdict | undefined,
  pageState: PageState,
  reason: EscalationReason,
  extra?: string,
): Promise<Escalation> {
  let shot: string | undefined;
  try {
    shot = await screenshot(page, `${cfg.secretsDir}/screenshots`, `${reason}-${verdict?.state ?? 'unknown'}`);
  } catch (e) {
    if (e instanceof ArtifactRefused) {
      extra = `${extra ? `${extra}\n\n` : ''}(No screenshot: card data may be on the page.)`;
    } else {
      log(`[escalate] screenshot failed: ${(e as Error).message}`);
    }
  }
  return buildEscalation(verdict, pageState, reason, extra, shot);
}
