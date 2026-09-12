import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIRequestContext } from 'playwright';

import { payableTotal, toCart, totalizerBreakdown, type VtexOrderForm } from '../adapters/orderform.js';
import { buildCart, describeCart, fetchOrderForm, handoffUrl, setQuantity } from '../checkout/cart.js';
import { loadConfig } from '../config.js';

const cfg = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s' });
const OF_ID = '9f2c1b0e4d5a4f7c8e1b2a3c4d5e6f70';

interface Recorded { method: string; url: string; data?: unknown }

/** A stand-in for Playwright's APIRequestContext: records calls, replays answers. */
function fakeReq(handlers: {
  get?: (url: string) => { status?: number; body?: unknown };
  post?: (url: string, data: unknown) => { status?: number; body?: unknown; text?: string };
}) {
  const calls: Recorded[] = [];
  const reply = (r: { status?: number; body?: unknown; text?: string }) => {
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.body ?? {});
    return {
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
  const req = {
    get: async (url: string) => {
      calls.push({ method: 'GET', url });
      return reply(handlers.get?.(url) ?? { status: 404 });
    },
    post: async (url: string, opts: { data: unknown }) => {
      calls.push({ method: 'POST', url, data: opts.data });
      return reply(handlers.post?.(url, opts.data) ?? { status: 404 });
    },
  } as unknown as APIRequestContext;
  return { req, calls };
}

const emptyOrderForm: VtexOrderForm = {
  orderFormId: OF_ID,
  items: [],
  totalizers: [],
  value: 0,
  clientProfileData: { email: 'me@example.com', firstName: 'Ana', document: '30123456' },
};

function withItems(items: Array<Partial<VtexOrderForm['items']> extends never ? never : NonNullable<VtexOrderForm['items']>[number]>): VtexOrderForm {
  const itemsTotal = items.reduce((s, i) => s + (i.sellingPrice ?? 0) * i.quantity, 0);
  return {
    ...emptyOrderForm,
    items,
    totalizers: [
      { id: 'Items', name: 'Total dos Itens', value: itemsTotal },
      { id: 'Shipping', name: 'Total do Frete', value: 150_000 },
    ],
    value: itemsTotal + 150_000,
  };
}

const LECHE = { id: '272382', name: 'Leche Descremada 1L', quantity: 2, seller: 'ardiaprod1080', sellingPrice: 234_000, availability: 'available' };
const PAN = { id: '119900', name: 'Pan Lactal', quantity: 1, seller: 'ardiaprod1080', sellingPrice: 180_000, availability: 'available' };

describe('orderForm mapping', () => {
  it('reads prices as centavos and multiplies out the line', () => {
    const cart = toCart(withItems([LECHE]), 'dia', OF_ID);
    assert.equal(cart.lines[0].unitPrice.centavos, 234_000);
    assert.equal(cart.lines[0].lineTotal.centavos, 468_000);
    assert.equal(cart.lines[0].lineTotal.display, '$ 4.680,00');
  });

  it('reports the Items subtotal as the cart total', () => {
    assert.equal(toCart(withItems([LECHE, PAN]), 'dia').total.centavos, 648_000);
  });

  it('but payableTotal includes shipping — that is what gets charged', () => {
    assert.equal(payableTotal(withItems([LECHE, PAN])), 798_000);
  });

  it('falls back to summing totalizers when value is absent', () => {
    const of = { ...withItems([LECHE]), value: undefined };
    assert.equal(payableTotal(of), 468_000 + 150_000);
  });

  it('keeps the totalizer breakdown for the approval summary', () => {
    assert.deepEqual(totalizerBreakdown(withItems([LECHE])).map((t) => t.id), ['Items', 'Shipping']);
  });

  it('marks an unavailable line so it cannot be mistaken for a purchase', () => {
    const cart = toCart(withItems([{ ...LECHE, availability: 'withoutStock' }]), 'dia');
    assert.equal(cart.lines[0].available, false);
  });

  it('carries store messages through verbatim', () => {
    const of = { ...emptyOrderForm, messages: [{ text: 'El precio cambió' }, { text: '' }] };
    assert.deepEqual(toCart(of, 'dia').messages, ['El precio cambió']);
  });
});

describe('fetchOrderForm', () => {
  it('asks for the session cart when no id is known', async () => {
    const { req, calls } = fakeReq({ get: () => ({ body: emptyOrderForm }) });
    const of = await fetchOrderForm(req, cfg);
    assert.equal(of.orderFormId, OF_ID);
    assert.match(calls[0].url, /\/api\/checkout\/pub\/orderForm\?sc=1$/);
  });

  it('refreshes stale data when an id is known', async () => {
    const { req, calls } = fakeReq({ get: () => ({ body: emptyOrderForm }) });
    await fetchOrderForm(req, cfg, OF_ID);
    assert.match(calls[0].url, new RegExp(`/orderForm/${OF_ID}\\?refreshOutdatedData=true$`));
  });

  it('blames the session, not the store, when no cart comes back', async () => {
    const { req } = fakeReq({ get: () => ({ status: 401 }) });
    await assert.rejects(fetchOrderForm(req, cfg), /session_status/);
  });
});

describe('buildCart', () => {
  function scenario(after: VtexOrderForm, before: VtexOrderForm = emptyOrderForm) {
    return fakeReq({
      get: () => ({ body: before }),
      post: (url) => (url.includes('/items') ? { body: after } : { status: 404 }),
    });
  }

  it('posts the items in the store own shape', async () => {
    const { req, calls } = scenario(withItems([LECHE]));
    await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post);
    assert.match(post.url, new RegExp(`/orderForm/${OF_ID}/items\\?sc=1$`));
    assert.deepEqual((post.data as { orderItems: unknown[] }).orderItems, [
      { id: '272382', quantity: 2, seller: 'ardiaprod1080' },
    ]);
  });

  it('asks for the sections it needs in the same round trip', async () => {
    const { req, calls } = scenario(withItems([LECHE]));
    await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    const sections = (calls.find((c) => c.method === 'POST')!.data as { expectedOrderFormSections: string[] })
      .expectedOrderFormSections;
    for (const s of ['items', 'totalizers', 'clientProfileData', 'shippingData', 'paymentData']) {
      assert.ok(sections.includes(s), s);
    }
  });

  it('returns the payable total and the handoff link', async () => {
    const { req } = scenario(withItems([LECHE]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    assert.equal(r.payableCentavos, 618_000);
    assert.equal(r.handoffUrl, handoffUrl(cfg, OF_ID));
    assert.match(r.handoffUrl, /#\/cart$/);
  });

  it('WARNS about items the user already had, and does not delete them', async () => {
    const { req, calls } = scenario(withItems([PAN, LECHE]), withItems([PAN]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    assert.equal(r.preExisting.length, 1);
    assert.match(r.warnings.join(' '), /already had 1 item\(s\)/);
    assert.match(r.warnings.join(' '), /will be paid for too/);
    assert.ok(!calls.some((c) => c.url.includes('removeAll')), 'must not silently empty the cart');
  });

  it('empties the cart first only when explicitly asked', async () => {
    const { req, calls } = fakeReq({
      get: () => ({ body: withItems([PAN]) }),
      post: (url) => ({ body: url.includes('removeAll') ? emptyOrderForm : withItems([LECHE]) }),
    });
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }], {
      clearFirst: true,
    });
    assert.ok(calls.some((c) => c.url.includes('removeAll')));
    assert.equal(r.warnings.length, 0);
  });

  it('reports a SKU the store silently dropped', async () => {
    const { req } = scenario(withItems([LECHE]));
    const r = await buildCart(req, cfg, [
      { skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' },
      { skuId: '999999', quantity: 1, sellerId: 'ardiaprod1080' },
    ]);
    assert.deepEqual(r.rejected.map((x) => x.skuId), ['999999']);
    assert.match(r.rejected[0].reason, /out of stock/);
  });

  it('reports a partial quantity rather than pretending it got what it asked for', async () => {
    const { req } = scenario(withItems([{ ...LECHE, quantity: 1 }]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 5, sellerId: 'ardiaprod1080' }]);
    assert.match(r.rejected[0].reason, /asked for 5, the store allowed 1/);
  });

  it('reports an item added but flagged unavailable', async () => {
    const { req } = scenario(withItems([{ ...LECHE, availability: 'withoutStock' }]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    assert.match(r.rejected[0].reason, /marked unavailable/);
  });

  it('treats a different seller as a different line', async () => {
    const { req } = scenario(withItems([LECHE]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'someone-else' }]);
    assert.equal(r.rejected.length, 1);
  });

  it('explains an HTTP failure and points at the likely cause', async () => {
    const { req } = fakeReq({
      get: () => ({ body: emptyOrderForm }),
      post: () => ({ status: 403, text: '{"message":"Cart does not belong to user"}' }),
    });
    await assert.rejects(
      buildCart(req, cfg, [{ skuId: '1', quantity: 1, sellerId: 's' }]),
      /HTTP 403[\s\S]*session has gone stale/,
    );
  });

  it('refuses a fractional or zero quantity before any request', async () => {
    const { req, calls } = scenario(withItems([LECHE]));
    await assert.rejects(buildCart(req, cfg, [{ skuId: '1', quantity: 0, sellerId: 's' }]), /positive whole number/);
    await assert.rejects(buildCart(req, cfg, [{ skuId: '1', quantity: 1.5, sellerId: 's' }]), /positive whole number/);
    assert.equal(calls.length, 0);
  });

  it('refuses an empty request', async () => {
    const { req } = scenario(emptyOrderForm);
    await assert.rejects(buildCart(req, cfg, []), /No items/);
  });
});

describe('setQuantity', () => {
  it('addresses the line by index, because that is what VTEX takes', async () => {
    const { req, calls } = fakeReq({ post: () => ({ body: withItems([{ ...LECHE, quantity: 3 }]) }) });
    const cart = await setQuantity(req, cfg, OF_ID, 0, 3);
    assert.deepEqual((calls[0].data as { orderItems: unknown[] }).orderItems, [{ index: 0, quantity: 3 }]);
    assert.equal(cart.lines[0].quantity, 3);
  });

  it('surfaces a failure instead of returning a stale cart', async () => {
    const { req } = fakeReq({ post: () => ({ status: 500 }) });
    await assert.rejects(setQuantity(req, cfg, OF_ID, 0, 3), /Could not update line 0/);
  });
});

describe('describeCart', () => {
  it('shows lines, the breakdown, the total and the link', async () => {
    const { req } = fakeReq({
      get: () => ({ body: emptyOrderForm }),
      post: () => ({ body: withItems([LECHE, PAN]) }),
    });
    const r = await buildCart(req, cfg, [
      { skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' },
      { skuId: '119900', quantity: 1, sellerId: 'ardiaprod1080' },
    ]);
    const text = describeCart(r);
    assert.match(text, /2× Leche Descremada 1L/);
    assert.match(text, /Total do Frete/);
    assert.match(text, /TOTAL/);
    assert.match(text, /Open it yourself: https:\/\//);
  });

  it('puts the warning where it cannot be missed', async () => {
    const { req } = fakeReq({
      get: () => ({ body: withItems([PAN]) }),
      post: () => ({ body: withItems([PAN, LECHE]) }),
    });
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    assert.match(describeCart(r), /! Your cart already had/);
  });
});
