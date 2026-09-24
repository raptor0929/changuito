import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { faucetConfirmCopy, usdcAmount } from '../faucet-copy.ts';
import { ENOUGH_UNITS, GRANT_UNITS } from '../faucet-policy.ts';

describe('usdcAmount', () => {
  it('formats token units the Argentine way', () => {
    assert.equal(usdcAmount(GRANT_UNITS), '50,00');
    assert.equal(usdcAmount(ENOUGH_UNITS), '100,00');
    assert.equal(usdcAmount(12_345_000n), '1,23');
    assert.equal(usdcAmount(0n), '0,00');
  });
});

describe('faucetConfirmCopy', () => {
  it('states the amount before anything is minted', () => {
    const copy = faucetConfirmCopy(0n);
    assert.equal(copy.confirm, 'Cargar 50,00 USDC');
    assert.match(copy.body, /50,00 USDC de prueba/);
    assert.match(copy.body, /No es plata real/);
    assert.equal(copy.dismiss, 'Cancelar');
  });

  it('asks the same way when the balance has not been read yet', () => {
    assert.equal(faucetConfirmCopy(null).confirm, 'Cargar 50,00 USDC');
  });

  it('offers nothing to confirm once the wallet has enough', () => {
    // The route would answer 429 anyway; a button that cannot work is worse
    // than no button.
    const copy = faucetConfirmCopy(ENOUGH_UNITS);
    assert.equal(copy.confirm, undefined);
    assert.match(copy.body, /suficiente/);
  });

  it('speaks voseo', () => {
    const all = [faucetConfirmCopy(0n), faucetConfirmCopy(ENOUGH_UNITS)]
      .flatMap((c) => [c.title, c.body, c.confirm ?? '', c.dismiss])
      .join(' ');
    assert.match(all, /Podés|Tenés|tenés/);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú)\b/i);
  });
});
