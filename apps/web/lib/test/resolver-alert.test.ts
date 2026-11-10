import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  checkoutAlert,
  RESOLVER_FAILURES_BEFORE_ALERT,
  resolverFailureCode,
  resolverLogLine,
  STUCK_AFTER_MS,
} from '../checkout/resolver-alert.ts';
import { escrowCopy } from '../checkout/copy.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('resolver alert', () => {
  const now = 10_000_000_000;

  it('stays quiet for a healthy run', () => {
    assert.equal(checkoutAlert({ startedAt: now - 60_000 }, now), null);
    assert.equal(checkoutAlert({ closeFailures: RESOLVER_FAILURES_BEFORE_ALERT - 1, startedAt: now }, now), null);
  });

  it('flags repeated resolver failures, before stuck', () => {
    assert.equal(checkoutAlert({ closeFailures: RESOLVER_FAILURES_BEFORE_ALERT, startedAt: now - STUCK_AFTER_MS - 1 }, now), 'resolver_failed');
  });

  it('flags a run past the timeout', () => {
    assert.equal(checkoutAlert({ startedAt: now - STUCK_AFTER_MS - 1 }, now), 'stuck');
  });

  it('never alerts on a closed order', () => {
    assert.equal(checkoutAlert({ closeFailures: 9, startedAt: 0, outcome: 'refunded' }, now), null);
  });

  it('classifies failures into codes', () => {
    assert.equal(resolverFailureCode(new Error('STELLAR_RESOLVER_SECRET is not set')), 'resolver_not_configured');
    assert.equal(resolverFailureCode(new Error('STELLAR_RESOLVER_SECRET is Abc, the escrow expects Def')), 'resolver_key_mismatch');
    assert.equal(resolverFailureCode(new Error('order account missing')), 'order_missing');
    assert.equal(resolverFailureCode(new Error('Transaction simulation failed: custom program error: 0x1771')), 'tx_rejected');
    assert.equal(resolverFailureCode(new Error('fetch failed')), 'rpc_unavailable');
    assert.equal(resolverFailureCode({}), 'unknown');
  });

  it('logs a short order prefix and codes only', () => {
    const id = 'a'.repeat(64);
    const line = resolverLogLine('resolver_close_failed', id, 'tx_rejected', 2);
    assert.deepEqual(line, { event: 'resolver_close_failed', order: 'aaaaaaaa', code: 'tx_rejected', failures: 2 });
    assert.ok(!JSON.stringify(line).includes(id));
  });

  it('the status route logs through the helper, never the raw error', () => {
    const route = src('../../app/api/checkout/status/route.ts');
    assert.match(route, /resolverLogLine\('resolver_close_failed'/);
    assert.doesNotMatch(route, /console\.error\('\[checkout\/status\] close', err\)/);
  });

  it('has copy for every alert in both languages', () => {
    for (const lang of ['es', 'en'] as const) {
      const c = escrowCopy(lang);
      for (const a of ['resolver_failed', 'stuck'] as const) {
        assert.ok(c.alertTitle[a].length > 0);
        assert.match(c.alertBody[a], /1 (hora|hour)/);
      }
    }
  });
});

