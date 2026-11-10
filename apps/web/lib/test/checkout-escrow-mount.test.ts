import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Source-level pins for the escrow mount, same shape as checkout-modal.test.ts:
 * strip-types has no DOM, so the gate has to be readable in the file.
 */
const source = readFileSync(join(import.meta.dirname, '../../components/CheckoutModal.tsx'), 'utf8');

describe('CheckoutModal escrow mount', () => {
  it('RULE: mounts PaymentModal on the login network', () => {
    assert.match(source, /import \{ PaymentModal \} from '\.\/PaymentModal'/);
    assert.match(
      source,
      /pollarEnabled && LOGIN_NETWORK !== null && network === LOGIN_NETWORK/,
    );
    assert.match(source, /<PaymentModal[\s\S]*onOpened=\{props\.onOpened\}/);
  });

  it('RULE: keeps the memo deposit rail off the login network', () => {
    // The deposit dialog is the fallback when the login-network gate fails —
    // a build with no Pollar key, or a network that is not the login one.
    assert.match(
      source,
      /return <CheckoutDialog \{\.\.\.props\} address=\{null\} sign=\{null\} pay=\{null\} \/>/,
    );
    // PaymentModal is returned first; the deposit dialog must not share that
    // branch or both would mount on testnet.
    const loginGateIdx = source.indexOf(
      'pollarEnabled && LOGIN_NETWORK !== null && network === LOGIN_NETWORK',
    );
    const paymentIdx = source.indexOf('<PaymentModal');
    const depositIdx = source.indexOf(
      'return <CheckoutDialog {...props} address={null} sign={null} pay={null} />',
    );
    assert.ok(loginGateIdx >= 0 && paymentIdx > loginGateIdx);
    assert.ok(depositIdx > paymentIdx);
  });
});
