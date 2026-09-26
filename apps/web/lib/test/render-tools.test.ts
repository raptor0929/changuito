import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import type { UiEvent } from '../protocol.ts';
import {
  autoRenderCart,
  cartLink,
  emptyCache,
  rememberStructured,
  runRenderTool,
  type RenderCache,
} from '../agent/render-tools.ts';

const money = (centavos: number) => ({ centavos, display: `$${(centavos / 100).toFixed(2)}` });

const CART_ID = '932b86e283104c35901d98cc1d67b557';
const LINK = `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${CART_ID}#/cart`;

const product = (skuId: string, name: string): Product => ({
  skuId,
  productId: `p-${skuId}`,
  name,
  sellerId: 'ardiaprod1080',
  price: money(315_000),
  available: true,
});

function line(skuId: string, quantity: number, unit: number, index = 0) {
  return {
    index,
    skuId,
    name: `sku ${skuId}`,
    quantity,
    sellerId: 'ardiaprod1080',
    unitPrice: money(unit),
    lineTotal: money(unit * quantity),
    available: true,
  };
}

function cart(lines = [line('1', 2, 315_000)], cartId = CART_ID): Cart {
  return {
    retailer: 'dia',
    cartId,
    lines,
    total: money(lines.reduce((n, l) => n + l.lineTotal.centavos, 0)),
    messages: [],
  };
}

/** Collects what the turn would have streamed to the browser. */
function recorder() {
  const events: UiEvent[] = [];
  return { events, emit: (e: UiEvent) => void events.push(e) };
}

const carts = (events: UiEvent[]) => events.filter((e) => e.t === 'cart');

/** What the MCP tools hand back, in the order a turn sees them. */
const addToCart = (c: Cart) => ({ cart: c });
const getCartLink = (c: Cart, handoffUrl = LINK) => ({ cart: c, handoffUrl });

describe('the cart draws itself', () => {
  it('RULE: a changed basket is drawn without the model asking', () => {
    // The bug: add_to_cart returned no structured cart, so the cache went stale
    // on the one call that changed it, and the model answered a modification by
    // pointing at the card already on screen — old lines, old total, same link.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 1);

    // The modification. Nothing calls render_cart.
    const bigger = cart([line('1', 2, 315_000), line('2', 1, 120_000, 1)]);
    rememberStructured(cache, addToCart(bigger));
    assert.equal(autoRenderCart(cache, emit), true);

    const drawn = carts(events);
    assert.equal(drawn.length, 2);
    assert.equal(drawn[1]?.cart.lines.length, 2);
    assert.equal(drawn[1]?.cart.total.centavos, 750_000);
    // The link comes along, because a payment section without one is the thing
    // the shopper was being sent back up the page for.
    assert.equal(drawn[1]?.handoffUrl, LINK);
  });

  it('RULE: an unchanged basket is not redrawn, however often it is mentioned', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);

    // view_cart, then get_cart_link again, then the same cart a third time.
    for (const structured of [{ cart: cart() }, getCartLink(cart()), { cart: cart() }]) {
      rememberStructured(cache, structured);
      assert.equal(autoRenderCart(cache, emit), false);
    }
    assert.equal(carts(events).length, 1);
  });

  it('notices a change that leaves the total alone', () => {
    // One 3.150,00 swapped for another. The card is different; the number is not.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    rememberStructured(cache, addToCart(cart([line('9', 2, 315_000)])));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 2);
    assert.equal(carts(events)[1]?.cart.lines[0]?.skuId, '9');
  });

  it('RULE: draws nothing until there is a link that opens this basket', () => {
    // A card whose only actionable control is missing is the case CLAUDE.md §2
    // warns about. add_to_cart comes first and has no link to give.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, addToCart(cart()));
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(cartLink(cache), undefined);

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 1);
  });

  it('RULE: never carries one basket’s link onto another', () => {
    // The URL has a cart id in it. A link kept across a change of basket — a
    // different retailer, a cart the store replaced — opens the wrong one.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    rememberStructured(cache, addToCart(cart([line('1', 1, 400_000)], 'a-different-cart')));
    assert.equal(cartLink(cache), undefined);
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(carts(events).length, 1);
  });

  it('draws nothing for an empty basket', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();
    rememberStructured(cache, getCartLink(cart([])));
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(carts(events).length, 0);
  });

  it('render_cart still shows an unchanged basket, and is not then repeated', () => {
    // The tool survives for the one job left to it: bringing the basket back
    // after a question about it.
    const cache = emptyCache();
    const { events, emit } = recorder();
    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    const res = runRenderTool(cache, { id: 'u1', name: 'render_cart', input: {} }, emit);
    assert.equal(res.is_error, undefined);
    assert.equal(carts(events).length, 2);
    // And the automatic render does not immediately say it a third time.
    assert.equal(autoRenderCart(cache, emit), false);
  });

  it('render_cart refuses before there is a cart', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_cart', input: {} }, emit);
    assert.equal(res.is_error, true);
    assert.equal(carts(events).length, 0);
  });
});

describe('product cards', () => {
  it('renders the SKUs the model picked, and says which it could not', () => {
    const cache: RenderCache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche'), product('2', 'Arroz')] });
    const { events, emit } = recorder();

    const res = runRenderTool(
      cache,
      { id: 'u1', name: 'render_products', input: { sku_ids: ['1', '404'], note: 'la más barata' } },
      emit,
    );

    const grid = events.filter((e) => e.t === 'products');
    assert.equal(grid.length, 1);
    assert.deepEqual(grid[0]?.items.map((p) => p.skuId), ['1']);
    assert.equal(grid[0]?.note, 'la más barata');
    assert.match(String(res.content), /Skipped unknown SKUs: 404/);
  });

  it('RULE: a second search renders its own new SKUs', () => {
    // The bug: the images only ever appeared for the first search, and a
    // shopper who asked for more got names in prose and had to ask for the
    // pictures. Nothing in the cache stops the second grid — the rule that
    // does it lives in the prompt and the tool description, and both are
    // checked in prompt.test.ts. This pins the half that is mechanical: the
    // SKUs of a later search are renderable the moment that search returns.
    const cache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche')] });
    const first = recorder();
    runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['1'] } }, first.emit);

    rememberStructured(cache, { products: [product('7', 'Leche con proteína')] });
    const second = recorder();
    const res = runRenderTool(cache, { id: 'u2', name: 'render_products', input: { sku_ids: ['7'] } }, second.emit);

    assert.equal(res.is_error, undefined);
    const grid = second.events.filter((e) => e.t === 'products');
    assert.deepEqual(grid[0]?.items.map((p) => p.skuId), ['7']);
  });

  it('RULE: refuses a SKU that never came from a search', () => {
    // An invented SKU is an invented price, above a button that spends money.
    const cache = emptyCache();
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['nope'] } }, emit);
    assert.equal(res.is_error, true);
    assert.equal(events.length, 0);
  });
});
