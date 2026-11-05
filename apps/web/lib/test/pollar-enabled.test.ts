import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOGIN_NETWORK, pollarEnabled } from '../pollar.ts';

describe('provider gating when the key is missing', () => {
  it('RULE: no login network means pollarEnabled is false', () => {
    // Unit tests run with neither NEXT_PUBLIC_ key set. WalletProvider must
    // render its children only — no PollarProvider — which is exactly what
    // `pollarEnabled === false` drives.
    assert.equal(LOGIN_NETWORK, null);
    assert.equal(pollarEnabled, false);
  });
});
