import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyEvent, endTurn, initialState, resetIds, sendUser, type ChatState } from '../chat-state.ts';
import type { UiEvent } from '../protocol.ts';

const run = (events: UiEvent[], from: ChatState = initialState) => events.reduce(applyEvent, from);

const money = (c: number) => ({ centavos: c, display: `$${(c / 100).toFixed(2)}` });
const product = (skuId: string) => ({
  skuId,
  productId: `p${skuId}`,
  name: `Producto ${skuId}`,
  sellerId: '1',
  price: money(1_000),
  available: true,
});
const cart = (id: string) => ({ retailer: 'dia', cartId: id, lines: [], total: money(0), messages: [] });

beforeEach(resetIds);

describe('applyEvent', () => {
  it('streams text into one block instead of one block per delta', () => {
    const s = run([
      { t: 'text', delta: 'Buscando ' },
      { t: 'text', delta: 'leche…' },
    ]);
    assert.equal(s.blocks.length, 1);
    assert.equal(s.blocks[0].kind === 'say' && s.blocks[0].text, 'Buscando leche…');
  });

  it('keeps text written after a grid below that grid', () => {
    // The ordering bug this file exists for: if the grid were appended at the
    // end of the turn, the sentence introducing it would read as its caption.
    const s = run([
      { t: 'text', delta: 'Encontré esto:' },
      { t: 'products', items: [product('1')] },
      { t: 'text', delta: 'La segunda conviene.' },
    ]);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['say', 'products', 'say']);
    assert.equal(s.blocks[2].kind === 'say' && s.blocks[2].text, 'La segunda conviene.');
  });

  it('separates thinking from the reply', () => {
    const s = run([
      { t: 'thinking', delta: 'comparar por kilo' },
      { t: 'text', delta: 'La de 1L.' },
    ]);
    const b = s.blocks[0];
    assert.ok(b.kind === 'say' && b.thinking === 'comparar por kilo' && b.text === 'La de 1L.');
  });

  it('closes a tool run on the block that started it, not the open one', () => {
    const s = run([
      { t: 'tool_start', id: 'call_1', name: 'search_products' },
      { t: 'products', items: [product('1')] },
      { t: 'text', delta: 'listo' },
      { t: 'tool_end', id: 'call_1', ok: true, ms: 812 },
    ]);
    const first = s.blocks[0];
    assert.ok(first.kind === 'say' && first.tools[0].ok === true && first.tools[0].ms === 812);
  });

  it('a tool_end for an unknown id changes nothing rather than throwing', () => {
    const before = run([{ t: 'text', delta: 'hola' }]);
    const after = applyEvent(before, { t: 'tool_end', id: 'ghost', ok: false, ms: 1 });
    assert.deepEqual(after.blocks, before.blocks);
  });

  it('tracks the newest cart for the pay button', () => {
    const s = run([
      { t: 'cart', cart: cart('old') },
      { t: 'cart', cart: cart('new'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.equal(s.cart?.cart.cartId, 'new');
    assert.equal(s.cart?.handoffUrl, 'https://dia/checkout');
  });

  it('done frees the composer and keeps the snapshot for the next turn', () => {
    const sent = sendUser(initialState, 'hola');
    assert.equal(sent.streaming, true);
    const s = applyEvent(sent, { t: 'done', stopReason: 'end_turn', snapshot: { location: '1414', carts: {} } as never });
    assert.equal(s.streaming, false);
    assert.deepEqual(s.snapshot, { location: '1414', carts: {} });
  });

  it('a recoverable error leaves the turn running; a fatal one ends it', () => {
    const sent = sendUser(initialState, 'hola');
    assert.equal(applyEvent(sent, { t: 'error', message: 'sin stock', recoverable: true }).streaming, true);
    assert.equal(applyEvent(sent, { t: 'error', message: 'se cayó', recoverable: false }).streaming, false);
  });
});

describe('endTurn', () => {
  it('frees a composer stranded by a dropped connection', () => {
    const s = endTurn(sendUser(initialState, 'hola'), 'Se cortó la conexión.');
    assert.equal(s.streaming, false);
    assert.equal(s.blocks.at(-1)?.kind, 'error');
  });

  it('does nothing when the turn already ended, so `done` is not doubled', () => {
    const done = applyEvent(sendUser(initialState, 'hola'), {
      t: 'done', stopReason: 'end_turn', snapshot: { location: undefined, carts: {} } as never,
    });
    assert.deepEqual(endTurn(done, 'x'), done);
  });
});
