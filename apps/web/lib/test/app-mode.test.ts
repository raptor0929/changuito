import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appMode, modeForSession, modeKeepsRecords, networkFor, type AppMode } from '../app-mode.ts';
import { DEFAULT_NETWORK, NETWORK_IDS } from '../deployments.ts';

const MODES: readonly AppMode[] = ['preview', 'production'];

describe('app mode', () => {
  it('RULE: the mode is the session, and nothing else', () => {
    // Not a toggle, not an environment variable, not a remembered
    // preference. There is exactly one input, and it is one nobody can set
    // from outside: whether Pollar signed them in.
    assert.equal(modeForSession(false), 'preview');
    assert.equal(modeForSession(true), 'production');
  });

  it('maps every network to a mode and back again', () => {
    for (const mode of MODES) assert.equal(appMode(networkFor(mode)), mode);
    for (const net of NETWORK_IDS) assert.equal(networkFor(appMode(net)), net);
  });

  it('RULE: a visitor with no session lands on the network that cannot spend', () => {
    // The first paint happens before Pollar has answered, so whatever
    // DEFAULT_NETWORK is has to already be the safe mode. If these ever
    // disagree, every page load starts in real mode for a moment.
    assert.equal(networkFor('preview'), DEFAULT_NETWORK);
    assert.equal(appMode(DEFAULT_NETWORK), 'preview');
  });

  it('RULE: preview keeps no records', () => {
    // The point of asking out loud. It is already true by accident of there
    // being no identity to key a row on — `archiveChat` refuses a guest,
    // `card_owner` wants a proven address — and an invariant that holds by
    // coincidence is one refactor from not holding.
    assert.equal(modeKeepsRecords(networkFor('preview')), false);
    assert.equal(modeKeepsRecords(networkFor('production')), true);
  });

  it('RULE: preview is testnet and production is mainnet, stated once', () => {
    // Pinned because a great deal reads it the other way round by
    // implication: which asset carries the memo, which Pollar key exists,
    // whether a secret key is allowed in the deployment at all.
    assert.equal(networkFor('preview'), 'testnet');
    assert.equal(networkFor('production'), 'mainnet');
  });
});
