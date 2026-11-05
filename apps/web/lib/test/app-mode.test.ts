import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modeForSession, modeKeepsRecords, sessionNetwork } from '../app-mode.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';

describe('app mode', () => {
  it('RULE: the mode is the session, and nothing else', () => {
    // Not a toggle, not an environment variable, not a remembered
    // preference. There is exactly one input, and it is one nobody can set
    // from outside: whether Pollar signed them in.
    assert.equal(modeForSession(false), 'preview');
    assert.equal(modeForSession(true), 'production');
  });

  it('RULE: mode and network are independent — there is no bijection', () => {
    // Replaces the old mode↔network round trip. Production on testnet is a
    // valid state: the session decides who pays, the Pollar key decides which
    // chain. There is nothing to round-trip.
    assert.equal(modeForSession(true), 'production');
    assert.equal(sessionNetwork(true, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(true, 'mainnet', DEFAULT_NETWORK), 'mainnet');
    assert.equal(sessionNetwork(false, 'mainnet', DEFAULT_NETWORK), DEFAULT_NETWORK);
  });

  it('RULE: a visitor with no session lands on the network that cannot spend', () => {
    // The first paint happens before Pollar has answered, so whatever
    // DEFAULT_NETWORK is has to already be the safe mode. If these ever
    // disagree, every page load starts in real mode for a moment.
    //
    // Call sites updated from the removed networkFor/appMode bijection to
    // sessionNetwork / modeForSession — same rule, new facts.
    assert.equal(sessionNetwork(false, null, DEFAULT_NETWORK), DEFAULT_NETWORK);
    assert.equal(modeForSession(false), 'preview');
  });

  it('RULE: preview keeps no records', () => {
    // The point of asking out loud. It is already true by accident of there
    // being no identity to key a row on — `archiveChat` refuses a guest,
    // `card_owner` wants a proven address — and an invariant that holds by
    // coincidence is one refactor from not holding.
    //
    // modeKeepsRecords now takes an AppMode (not a NetworkId). Same rule.
    assert.equal(modeKeepsRecords('preview'), false);
    assert.equal(modeKeepsRecords('production'), true);
  });

  it('RULE: a guest is on the default network; a session is on the login network', () => {
    // Replaces "preview is testnet and production is mainnet". Network follows
    // the Pollar key; mode follows the session. They are not a fixed pair.
    assert.equal(sessionNetwork(false, 'testnet', DEFAULT_NETWORK), DEFAULT_NETWORK);
    assert.equal(sessionNetwork(false, 'mainnet', DEFAULT_NETWORK), DEFAULT_NETWORK);
    assert.equal(sessionNetwork(true, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(true, 'mainnet', DEFAULT_NETWORK), 'mainnet');
    assert.equal(modeForSession(false), 'preview');
    assert.equal(modeForSession(true), 'production');
  });
});
