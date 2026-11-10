import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The shopper checkout signs the escrow in the browser. These lines are the
 * ones whose absence would let a foreign transaction, or a made-up explorer
 * link, through without a test noticing.
 */
const source = readFileSync(join(import.meta.dirname, '../../components/CheckoutModal.tsx'), 'utf8');

describe('the escrow checkout', () => {
  it('RULE: the buyer signs escrow.open, not a transaction built elsewhere', () => {
    assert.match(source, /wallet\.openEscrow\(\{/);
    assert.match(source, /orderId: quote\.orderId/);
    assert.match(source, /amount: quote\.amount/);
    assert.match(source, /basketHash: quote\.basketHash/);
    assert.doesNotMatch(source, /signTransaction\(/);
  });

  it('RULE: the receipt link is the explorer for this chain', () => {
    assert.match(source, /explorer\.tx\(/);
    assert.doesNotMatch(source, /solscan\.io/);
  });

  it('RULE: a signature already in hand is not asked for again', () => {
    assert.match(source, /pendingOpen\?\.orderId === quote\.orderId/);
    assert.match(source, /if \(!fundedSig\)/);
  });
});
