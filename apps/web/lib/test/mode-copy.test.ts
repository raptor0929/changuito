import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NETWORK_IDS } from '../deployments.ts';
import { MODES, modeCopy, modeLockedReason, TRUSTLINE } from '../mode-copy.ts';

/**
 * The chrome obeys the same vocabulary rule as the agent: lib/agent/prompt.ts
 * forbids these words in anything a user reads.
 */
const FORBIDDEN =
  /\b(testnet|mainnet|blockchain|wallet|billetera virtual|on-chain|cripto|crypto|web3|defi|stellar|soroban|mcp|escrow|smart ?contract)\b/i;

const every = [
  ...MODES.flatMap((m) => [m.label, m.short, m.balanceUnit, m.hint, m.payNote, m.holdNote, m.payLabel('12,34')]),
  modeLockedReason('not-allowed'),
  modeLockedReason('not-ready'),
  ...Object.values(TRUSTLINE),
].filter(Boolean);

describe('mode copy', () => {
  it('has a voice for every network, and only those', () => {
    assert.deepEqual(MODES.map((m) => m.network), [...NETWORK_IDS]);
    for (const net of NETWORK_IDS) assert.equal(modeCopy(net).network, net);
  });

  it('RULE: shows the safe mode first', () => {
    assert.equal(MODES[0]?.network, 'testnet');
  });

  it('RULE: never names a network, a chain or a wallet', () => {
    for (const text of every) {
      assert.doesNotMatch(text, FORBIDDEN, `forbidden word in: ${text}`);
    }
  });

  it('speaks voseo, never tuteo', () => {
    const all = every.join(' ');
    assert.match(all, /Podés|Revisá/);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú|revisa tu|entra a)\b/i);
  });

  it('RULE: the qualifier on the number is what tells a test balance apart', () => {
    // The bug this fixes: every "no es plata real" string used to live behind
    // the faucet, which most visitors never reach. This one is always on
    // screen, next to the number.
    assert.match(modeCopy('testnet').balanceUnit, /de prueba/);
    assert.equal(modeCopy('mainnet').balanceUnit, 'USDC');
    assert.notEqual(modeCopy('testnet').balanceUnit, modeCopy('mainnet').balanceUnit);
  });

  it('says plainly, in test mode, that nothing is being spent', () => {
    assert.match(modeCopy('testnet').hint, /No es plata real/);
    assert.match(modeCopy('testnet').payNote, /prueba/);
    assert.match(modeCopy('testnet').payLabel('12,34'), /Probar/);
  });

  it('says plainly, in real mode, that it is', () => {
    assert.match(modeCopy('mainnet').hint, /plata real/);
    assert.equal(modeCopy('mainnet').payLabel('12,34'), 'Pagar 12,34 USDC');
  });

  it('explains the one-time step without naming what it is', () => {
    // It costs nothing, it happens once, and there is a way out. All three
    // have to be on screen, because none of them is guessable.
    assert.match(TRUSTLINE.body, /gratis/);
    assert.match(TRUSTLINE.body, /no se vuelve a pedir/);
    assert.match(TRUSTLINE.failed, /modo prueba/);
    assert.match(TRUSTLINE.back, /modo prueba/);
  });

  it('tells "not for you" apart from "not yet for anyone"', () => {
    const reasons = (['not-allowed', 'not-ready'] as const).map(modeLockedReason);
    assert.equal(new Set(reasons).size, 2);
    for (const r of reasons) assert.match(r, /modo real/);
  });
});
