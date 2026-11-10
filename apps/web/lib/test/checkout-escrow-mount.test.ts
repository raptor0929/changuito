import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The wallet the copied shopper sees is Pollar. These lines are what keeps
 * that true after the checkout UI moved.
 */
const provider = readFileSync(join(import.meta.dirname, '../../components/WalletProvider.tsx'), 'utf8');
const bridge = readFileSync(join(import.meta.dirname, '../../components/WalletBridge.tsx'), 'utf8');
const modal = readFileSync(join(import.meta.dirname, '../../components/CheckoutModal.tsx'), 'utf8');

describe('CheckoutModal escrow mount', () => {
  it('RULE: Pollar is the wallet, and the checkout does not import another one', () => {
    assert.match(provider, /PollarProvider/);
    assert.match(provider, /WalletBridge/);
    assert.match(bridge, /method: 'open'/);
    assert.match(bridge, /useWalletSigner/);
    assert.doesNotMatch(modal, /from '@privy/);
    assert.doesNotMatch(modal, /PaymentModal/);
  });

  it('RULE: opening an order uses the contract id from this request', () => {
    assert.match(bridge, /\/api\/contracts\?network=/);
    assert.match(bridge, /contractId: json\.escrowId/);
  });
});
