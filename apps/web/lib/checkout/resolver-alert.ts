/**
 * When the resolver lets a shopper down, and how we hear about it.
 *
 * "Resolver" is the backend hot key in lib/server/resolver.ts: the only signer
 * that can settle an escrow order to the treasury or refund it to the buyer.
 * /api/checkout/status asks it to close the order once the sandbox job ends.
 * Two things can leave an order open with the shopper staring at a spinner:
 *
 *   - `resolver_failed`: the settle/refund transaction threw (key missing or
 *     wrong, RPC down, simulation rejected). The poll retries, but after a few
 *     failures the shopper deserves to know.
 *   - `stuck`: the job started long ago and the order is still not closed
 *     (sandbox unreachable, job hung).
 *
 * Either way the USDC is safe: the program lets the buyer refund on chain once
 * the order's deadline passes. The log line carries a short order prefix and
 * a reason *code* only: never the error message (it can carry addresses or
 * program logs), never the buyer, the basket or an amount. Pure, so testable.
 */
import type { CheckoutAlert } from './types.ts';

/** Failed closes before we tell the shopper. One blip is retried silently. */
export const RESOLVER_FAILURES_BEFORE_ALERT = 3;
/** A run normally ends in 2–4 minutes; 15 is clearly wrong but well inside the 1 h escrow deadline. */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

export function checkoutAlert(
  rec: { startedAt?: number; closeFailures?: number; outcome?: string },
  now: number,
): CheckoutAlert | null {
  if (rec.outcome) return null;
  if ((rec.closeFailures ?? 0) >= RESOLVER_FAILURES_BEFORE_ALERT) return 'resolver_failed';
  if (rec.startedAt && now - rec.startedAt > STUCK_AFTER_MS) return 'stuck';
  return null;
}

/** Why a close failed, as a code. Reads the message only to classify it. */
export function resolverFailureCode(err: unknown): string {
  const m = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/RESOLVER_SECRET is not set/.test(m)) return 'resolver_not_configured';
  if (/the escrow expects/.test(m)) return 'resolver_key_mismatch';
  if (/order account missing/.test(m)) return 'order_missing';
  if (/simulat|custom program error|InstructionError/i.test(m)) return 'tx_rejected';
  if (/blockhash|block height exceeded/i.test(m)) return 'tx_expired';
  if (/fetch failed|ECONN|ETIMEDOUT|429|5\d\d/i.test(m)) return 'rpc_unavailable';
  return 'unknown';
}

export interface ResolverLogLine {
  event: 'resolver_close_failed' | 'checkout_alert';
  /** First 8 hex chars: enough to find the record, not the whole id. */
  order: string;
  code: string;
  failures?: number;
}

export function resolverLogLine(
  event: ResolverLogLine['event'],
  orderId: string,
  code: string,
  failures?: number,
): ResolverLogLine {
  const line: ResolverLogLine = { event, order: orderId.slice(0, 8), code };
  if (failures !== undefined) line.failures = failures;
  return line;
}
