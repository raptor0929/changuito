import type { VtexOrderForm } from '../adapters/orderform.js';
import { log } from '../secure/redact.js';
import { classifyDeterministic } from './classify/index.js';
import type { EscalationReason } from './classify/escalate.js';
import { type PageState, signature, summarize } from './pagestate.js';
import { type Action, planAction, satisfiesGoal } from './states.js';
import type { Escalation, Goal, Verdict } from './types.js';
import { TERMINAL } from './types.js';

/**
 * The loop.
 *
 *     observe  → build a compact page state
 *     classify → which known state is this?
 *     act      → run that state's handler (idempotent)
 *     assert   → did we advance? if not, count a stall; 3 stalls → escalate
 *
 * Order stops mattering. An unexpected extra screen is one more iteration. A
 * screen shown twice is harmless because handlers are idempotent. A screen we
 * have never seen does not crash the run — it escalates to the user.
 *
 * Everything that touches a browser lives behind `FlowDriver`, so this file —
 * the part that decides whether to keep clicking in a checkout that is about to
 * spend real money — is testable with a fake driver and no browser at all.
 */

export interface Observation {
  pageState: PageState;
  /** Layer 1's input. Absent when the orderForm could not be read. */
  orderForm?: VtexOrderForm;
}

export interface FlowDriver {
  observe(): Promise<Observation>;
  /** Carry out a planned action. Throwing aborts the run. */
  perform(action: Action, verdict: Verdict, obs: Observation): Promise<void>;
  /** Layer 3. Omitted when Jev is disabled — the loop is then strictly Layers 1, 2, 4. */
  classifyJev?(ps: PageState): Promise<Verdict | undefined>;
  /** Layer 4. Builds the escalation; the loop throws it. */
  escalate(
    verdict: Verdict | undefined,
    obs: Observation,
    reason: EscalationReason,
    extra?: string,
  ): Promise<Escalation>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface FlowOptions {
  goal: Goal;
  maxSteps?: number;
  maxMs?: number;
  /** Non-advancing iterations tolerated before escalating. */
  maxStalls?: number;
  /** 'wait' iterations tolerated on a legitimately busy screen. */
  maxWaits?: number;
  /**
   * Whether a delivery address has been captured. False makes the 'address'
   * screen fatal rather than something to fill in — we do not invent one.
   */
  hasAddress?: boolean;
}

export interface FlowStep {
  step: number;
  verdict: Verdict;
  action: Action;
}

export interface FlowResult {
  goal: Goal;
  /** True only when the final state satisfies the goal. */
  reached: boolean;
  verdict: Verdict;
  pageState: PageState;
  orderForm?: VtexOrderForm;
  steps: number;
  history: FlowStep[];
}

export const DEFAULTS = { maxSteps: 25, maxMs: 4 * 60_000, maxStalls: 3, maxWaits: 20 } as const;

export async function runFlow(driver: FlowDriver, opts: FlowOptions): Promise<FlowResult> {
  const maxSteps = opts.maxSteps ?? DEFAULTS.maxSteps;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const maxStalls = opts.maxStalls ?? DEFAULTS.maxStalls;
  const maxWaits = opts.maxWaits ?? DEFAULTS.maxWaits;

  const started = driver.now();
  const history: FlowStep[] = [];
  let lastSignature: string | undefined;
  let stalls = 0;
  let waits = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (driver.now() - started > maxMs) {
      const obs = await driver.observe();
      throw await driver.escalate(
        history.at(-1)?.verdict,
        obs,
        'budget_exhausted',
        `Gave up after ${Math.round((driver.now() - started) / 1000)}s and ${step - 1} steps.`,
      );
    }

    const obs = await driver.observe();
    const verdict = await classify(driver, obs);

    if (!verdict) {
      throw await driver.escalate(undefined, obs, 'unknown_screen');
    }

    log(`[flow] step ${step}: ${verdict.state} (${verdict.layer}) — ${verdict.why}`);

    // Terminal and goal checks come before planning, so the loop can never act
    // on a confirmation page. Re-submitting a placed order is the one mistake
    // with no undo.
    if (satisfiesGoal(verdict.state, opts.goal)) {
      return done(opts.goal, true, verdict, obs, history);
    }
    if (TERMINAL.has(verdict.state)) {
      return done(opts.goal, false, verdict, obs, history);
    }

    const action = planAction(verdict, obs.pageState, {
      goal: opts.goal,
      hasAddress: opts.hasAddress ?? true,
    });
    history.push({ step, verdict, action });

    if (action.kind === 'none') {
      throw await driver.escalate(verdict, obs, reasonFor(verdict), action.why);
    }

    // Stall accounting. A 'wait' is *supposed* to leave the page unchanged, so
    // it gets its own, longer patience rather than tripping the stall counter
    // three iterations into a slow gateway.
    const sig = signature(obs.pageState);
    if (action.kind === 'wait') {
      if (++waits > maxWaits) {
        throw await driver.escalate(
          verdict,
          obs,
          'stalled',
          `Waited ${maxWaits} times and the page is still showing a busy screen.`,
        );
      }
    } else if (sig === lastSignature) {
      if (++stalls >= maxStalls) {
        throw await driver.escalate(
          verdict,
          obs,
          'stalled',
          `Tried ${stalls} times and the page did not change. Last attempt: ${describe(action)}.`,
        );
      }
    } else {
      stalls = 0;
      waits = 0;
    }
    lastSignature = sig;

    await driver.perform(action, verdict, obs);
    if (action.kind === 'wait') await driver.sleep(action.ms);
  }

  const obs = await driver.observe();
  throw await driver.escalate(
    history.at(-1)?.verdict,
    obs,
    'budget_exhausted',
    `Ran the full budget of ${maxSteps} steps without reaching '${opts.goal}'.\n${summarize(obs.pageState)}`,
  );
}

/** Layers 1 and 2 are pure and free; Layer 3 costs a round trip, so it is last. */
async function classify(driver: FlowDriver, obs: Observation): Promise<Verdict | undefined> {
  const deterministic = classifyDeterministic(obs);
  if (deterministic) return deterministic;
  if (!driver.classifyJev) return undefined;
  try {
    return await driver.classifyJev(obs.pageState);
  } catch (e) {
    // Fail closed: an unreachable classifier is an unknown screen, not a guess.
    log(`[flow] Jev failed, treating the screen as unknown: ${(e as Error).message}`);
    return undefined;
  }
}

/** A state we recognise but cannot act on says more than "unknown screen". */
function reasonFor(verdict: Verdict): EscalationReason {
  if (verdict.state === 'cart_changed') return 'store_problem';
  if (verdict.state === 'unknown') return 'unknown_screen';
  return 'no_action';
}

function describe(a: Action): string {
  return a.kind === 'click' ? `clicked "${a.label}"` : a.kind;
}

function done(
  goal: Goal,
  reached: boolean,
  verdict: Verdict,
  obs: Observation,
  history: FlowStep[],
): FlowResult {
  return {
    goal,
    reached,
    verdict,
    pageState: obs.pageState,
    orderForm: obs.orderForm,
    steps: history.length,
    history,
  };
}
