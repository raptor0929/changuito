import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { archiveChat, chatTitle, type ArchiveDeps } from '../chat-archive.ts';

import type { Turn } from '../agent/loop.ts';

const WALLET = `G${'A'.repeat(55)}`;

/**
 * A turn built by hand rather than with `newTurnState()`: importing loop.ts
 * would drag the MCP bridge in behind it, and this file has to load under
 * `--experimental-strip-types` with nothing reachable.
 */
function turnWith(text: string): Turn {
  return {
    messages: [{ role: 'user', content: text }],
    cache: { products: new Map([['sku-1', { sku: 'sku-1' } as never]]) },
  } as Turn;
}

function spy(): ArchiveDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    hasDatabase: () => true,
    saveChat: async (c) => {
      calls.push(c);
    },
  };
}

describe('the title a chat gets in a list', () => {
  it('is the shopper\'s own words', () => {
    assert.equal(chatTitle('quiero fideos y salsa'), 'quiero fideos y salsa');
  });

  it('collapses a pasted list onto one line', () => {
    assert.equal(chatTitle('  fideos\n  salsa\n\n  queso  '), 'fideos salsa queso');
  });

  it('is null when there is nothing in it, so the caller can fall back to a date', () => {
    assert.equal(chatTitle('   \n  '), null);
    assert.equal(chatTitle(''), null);
  });

  it('truncates by character, and says it did', () => {
    const long = 'a'.repeat(200);
    const title = chatTitle(long)!;
    assert.equal(title.length, 120);
    assert.ok(title.endsWith('…'));
  });
});

describe('archiving a conversation', () => {
  it('RULE: a guest is never written down', async () => {
    const deps = spy();
    const outcome = await archiveChat(
      { id: 'c1', network: 'testnet', address: null, turn: turnWith('hola'), title: 'hola' },
      deps,
    );
    assert.equal(outcome, 'guest');
    assert.deepEqual(deps.calls, [], 'a guest transcript reached the database');
  });

  it('writes nothing with no database configured', async () => {
    const deps = { ...spy(), hasDatabase: () => false };
    assert.equal(
      await archiveChat(
        { id: 'c1', network: 'testnet', address: WALLET, turn: turnWith('hola'), title: 'hola' },
        deps,
      ),
      'no-database',
    );
  });

  it('saves the wallet, the network and the title as given', async () => {
    const deps = spy();
    assert.equal(
      await archiveChat(
        { id: 'c1', network: 'mainnet', address: WALLET, turn: turnWith('hola'), title: 'hola' },
        deps,
      ),
      'saved',
    );
    const saved = deps.calls[0] as { id: string; network: string; address: string; title: string | null };
    assert.equal(saved.id, 'c1');
    assert.equal(saved.network, 'mainnet');
    assert.equal(saved.address, WALLET);
    assert.equal(saved.title, 'hola');
  });

  it('RULE: the render cache survives the trip, because a Map does not stringify', async () => {
    const deps = spy();
    await archiveChat(
      { id: 'c1', network: 'testnet', address: WALLET, turn: turnWith('hola'), title: null },
      deps,
    );
    const saved = deps.calls[0] as { transcript: { v: number; products: [string, unknown][] } };
    // The whole reason encodeTurn exists: JSON.stringify renders a Map as `{}`
    // with no error, so a spread here would store an empty cache silently.
    assert.equal(saved.transcript.v, 1);
    assert.deepEqual(
      saved.transcript.products.map(([sku]) => sku),
      ['sku-1'],
    );
    assert.ok(JSON.stringify(saved.transcript).includes('sku-1'));
  });

  it('RULE: a database that is down costs the archive, never the turn', async () => {
    const deps: ArchiveDeps = {
      hasDatabase: () => true,
      saveChat: async () => {
        throw new Error('connection refused');
      },
    };
    assert.equal(
      await archiveChat(
        { id: 'c1', network: 'testnet', address: WALLET, turn: turnWith('hola'), title: null },
        deps,
      ),
      'failed',
    );
  });
});
