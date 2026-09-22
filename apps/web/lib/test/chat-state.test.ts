import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyEvent, endTurn, initialState, omitErrorMessage, resetIds, sendUser, type ChatState } from '../chat-state.ts';
import { LOGIN_REQUIRED_MESSAGE } from '../login-constants.ts';
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

  it('draws one card when the same cart is rendered twice in a turn', () => {
    // What the user actually saw: a card with no link, then the same basket
    // again with one. It reads as two orders.
    const s = run([
      { t: 'cart', cart: cart('c1') },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['cart']);
    assert.equal(s.blocks[0].kind === 'cart' && s.blocks[0].handoffUrl, 'https://dia/checkout');
  });

  it('reuses the block id so the card updates in place', () => {
    // React keys off it. A new id unmounts the card and animates a new one in,
    // which looks exactly like the duplicate this replaced.
    const s = run([
      { t: 'cart', cart: cart('c1') },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.equal(s.blocks[0].id, 'b1');
  });

  it('never takes the link back off a card that already had one', () => {
    const s = run([
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
      { t: 'cart', cart: cart('c1') },
    ]);
    assert.equal(s.blocks[0].kind === 'cart' && s.blocks[0].handoffUrl, 'https://dia/checkout');
    assert.equal(s.cart?.handoffUrl, 'https://dia/checkout');
  });

  it('keeps the cart from an earlier turn as a record of what it was then', () => {
    // Merging across turns would rewrite a card the user has already scrolled
    // past — the basket as it was three messages ago is part of the story.
    const first = run([{ t: 'cart', cart: cart('c1') }], sendUser(initialState, 'armá un desayuno'));
    const s = run([{ t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' }], sendUser(first, 'sumá café'));

    assert.deepEqual(s.blocks.map((b) => b.kind), ['user', 'cart', 'user', 'cart']);
    assert.equal(s.blocks[1].kind === 'cart' && s.blocks[1].handoffUrl, undefined);
    assert.equal(s.blocks[3].kind === 'cart' && s.blocks[3].handoffUrl, 'https://dia/checkout');
  });

  it('still shows both when the cart is genuinely a different one', () => {
    const s = run([
      { t: 'cart', cart: cart('old') },
      { t: 'cart', cart: cart('new') },
    ]);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['cart', 'cart']);
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

  it('drops the login-required line and leaves other errors in place', () => {
    const gated = endTurn(sendUser(initialState, 'asado para 6'), LOGIN_REQUIRED_MESSAGE);
    assert.equal(
      gated.blocks.some((b) => b.kind === 'error' && b.message.includes('Para seguir, iniciá sesión')),
      true,
    );
    const cleared = omitErrorMessage(gated, LOGIN_REQUIRED_MESSAGE);
    assert.equal(
      cleared.blocks.some((b) => b.kind === 'error' && /Para seguir, iniciá sesión/.test(b.message)),
      false,
    );
    assert.equal(omitErrorMessage(cleared, LOGIN_REQUIRED_MESSAGE), cleared);

    const withStock = endTurn(sendUser(cleared, 'milanesas'), 'sin stock');
    const still = omitErrorMessage(withStock, LOGIN_REQUIRED_MESSAGE);
    const errors = still.blocks.filter((b) => b.kind === 'error');
    assert.equal(errors.length, 1);
    if (errors[0]?.kind === 'error') assert.equal(errors[0].message, 'sin stock');
  });

  it('does nothing when the turn already ended, so `done` is not doubled', () => {
    const done = applyEvent(sendUser(initialState, 'hola'), {
      t: 'done', stopReason: 'end_turn', snapshot: { location: undefined, carts: {} } as never,
    });
    assert.deepEqual(endTurn(done, 'x'), done);
  });
});
