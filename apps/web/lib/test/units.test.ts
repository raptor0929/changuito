import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { stroops } from '../units.ts';

/**
 * The arithmetic itself is pinned in deposit-watch.test.ts, against the matcher
 * that is its reason for existing, and it stays there: moving those assertions
 * would be churn, and the re-export means they still run over this
 * implementation.
 *
 * What is pinned here is the property that made the move worth doing — this
 * file has no imports. CheckoutModal is a client component and needs `stroops`
 * to compare an importe against a balance; the module it used to live in pulls
 * in @stellar/stellar-sdk by way of `horizon`, which is hundreds of kilobytes
 * of XDR codec in a page bundle. One `import` added here quietly undoes that,
 * and nothing else in the build would complain.
 */
describe('lib/units.ts', () => {
  it('RULE: imports nothing, so a client component can have it', () => {
    const source = readFileSync(join(import.meta.dirname, '../units.ts'), 'utf8');
    // Matches `import x from` and `import 'x'` alike. A type-only import would
    // be erased and harmless, but there is nothing here that needs one, and an
    // exception is how the next one gets in.
    assert.doesNotMatch(source, /^\s*import\b/m);
  });

  it('still counts what it counted before', () => {
    // A smoke test, not the suite: one case so a broken re-export fails here
    // too rather than only in deposit-watch's file.
    assert.equal(stroops('1.5'), 15_000_000n);
    assert.equal(stroops('12.24'), 122_400_000n);
    assert.equal(stroops('nope'), null);
  });
});
