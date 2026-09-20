import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { Cart, CartLine } from '@changuito/mcp/types';

import {
  basketHash,
  canonicalBasket,
  canonicalReceipt,
  receiptHash,
  DEFAULT_TIMEOUT_SECS,
  fromHex,
  MAX_TIMEOUT_SECS,
  MIN_TIMEOUT_SECS,
  newOrderId,
  openArgs,
  toBase64,
  toHex,
} from '../order.ts';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  index: 0,
  skuId: '12345',
  name: 'Leche descremada 1L',
  quantity: 2,
  sellerId: '1',
  unitPrice: { centavos: 150_000, display: '$1.500,00' },
  lineTotal: { centavos: 300_000, display: '$3.000,00' },
  available: true,
  ...over,
});

const cart = (over: Partial<Cart> = {}): Cart => ({
  retailer: 'dia',
  cartId: 'abc-123',
  lines: [line()],
  total: { centavos: 300_000, display: '$3.000,00' },
  messages: [],
  ...over,
});

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe('hex and base64', () => {
  it('round-trips through hex', () => {
    const id = newOrderId();
    assert.deepEqual(fromHex(toHex(id)), id);
  });

  it('pads a low byte rather than dropping a nibble', () => {
    assert.equal(toHex(new Uint8Array([0, 1, 255])), '0001ff');
  });

  it('encodes base64 the way Pollar reads a `bytes` arg', () => {
    assert.equal(toBase64(new Uint8Array([0, 1, 2, 3])), 'AAECAw==');
  });
});

describe('newOrderId', () => {
  it('is 32 bytes, which is what BytesN<32> means', () => {
    assert.equal(newOrderId().length, 32);
  });

  it('is not derived from anything — two calls differ', () => {
    // If ids were a hash of the basket, a user retrying a payment that failed
    // in their wallet would be rejected for OrderExists.
    assert.notEqual(toHex(newOrderId()), toHex(newOrderId()));
  });
});

describe('canonicalBasket', () => {
  it('is stable across two equal carts built in a different order', () => {
    const a = cart({ lines: [line({ index: 0 }), line({ index: 1, skuId: '999' })] });
    const b = cart({ lines: [line({ index: 1, skuId: '999' }), line({ index: 0 })] });
    assert.equal(canonicalBasket(a), canonicalBasket(b));
  });

  it('carries a version tag, because a hash is a promise about bytes', () => {
    assert.match(canonicalBasket(cart()), /^changuito\/basket\/v1\n/);
  });

  it('does not depend on the display strings, which are a formatting choice', () => {
    const other = cart({ total: { centavos: 300_000, display: '3000 pesos' } });
    assert.equal(canonicalBasket(cart()), canonicalBasket(other));
  });

  it('ignores store messages, which change without the basket changing', () => {
    assert.equal(canonicalBasket(cart()), canonicalBasket(cart({ messages: ['Promo 2x1'] })));
  });
});

describe('basketHash', () => {
  it('is 32 bytes and deterministic', async () => {
    const a = await basketHash(cart());
    const b = await basketHash(cart());
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);
  });

  it('RULE: changing anything the user was shown changes the hash', async () => {
    // This is the whole point of the commitment. Each of these is a way the
    // agent could settle against a basket the user never approved.
    const base = toHex(await basketHash(cart()));
    const variants: Record<string, Cart> = {
      quantity: cart({ lines: [line({ quantity: 3 })] }),
      sku: cart({ lines: [line({ skuId: '54321' })] }),
      'line price': cart({ lines: [line({ lineTotal: { centavos: 400_000, display: '$4.000,00' } })] }),
      total: cart({ total: { centavos: 999_999, display: '$9.999,99' } }),
      availability: cart({ lines: [line({ available: false })] }),
      retailer: cart({ retailer: 'carrefour' }),
      'an extra line': cart({ lines: [line(), line({ index: 1, skuId: '777' })] }),
    };
    for (const [what, c] of Object.entries(variants)) {
      assert.notEqual(toHex(await basketHash(c)), base, `${what} left the basket hash unchanged`);
    }
  });
});

describe('openArgs', () => {
  const ok = {
    buyer: 'GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK',
    orderId: bytes(32, 1),
    amountUnits: 250_000_000n,
    basketHash: bytes(32, 2),
  };

  it('encodes each argument as the type Soroban expects', () => {
    const args = openArgs(ok);
    assert.deepEqual(
      args.map((a) => a.type),
      ['address', 'bytes', 'i128', 'bytes', 'u64'],
    );
    assert.equal(args[0].value, ok.buyer);
    assert.equal(args[1].value, toBase64(ok.orderId));
    // i128 travels as a string: 2^53 is not far above a sensible balance in
    // 7-decimal units, and JSON numbers stop being exact there.
    assert.equal(args[2].value, '250000000');
    assert.equal(args[4].value, String(DEFAULT_TIMEOUT_SECS));
  });

  it('defaults to a timeout the contract will accept', () => {
    assert.ok(DEFAULT_TIMEOUT_SECS >= MIN_TIMEOUT_SECS && DEFAULT_TIMEOUT_SECS <= MAX_TIMEOUT_SECS);
  });

  it('refuses a hash that is not 32 bytes rather than letting the ledger say no', () => {
    assert.throws(() => openArgs({ ...ok, orderId: bytes(31) }), /32 bytes/);
    assert.throws(() => openArgs({ ...ok, basketHash: bytes(33) }), /32 bytes/);
  });

  it('refuses a zero or negative amount', () => {
    assert.throws(() => openArgs({ ...ok, amountUnits: 0n }), /positive/);
    assert.throws(() => openArgs({ ...ok, amountUnits: -1n }), /positive/);
  });

  it('refuses a timeout outside the contract bounds', () => {
    assert.throws(() => openArgs({ ...ok, timeoutSecs: MIN_TIMEOUT_SECS - 1 }), /timeout_secs/);
    assert.throws(() => openArgs({ ...ok, timeoutSecs: MAX_TIMEOUT_SECS + 1 }), /timeout_secs/);
  });
});

describe('RULE: the args match the contract they are sent to', () => {
  it('open() still takes (buyer, order_id, amount, basket_hash, timeout_secs)', async () => {
    // Soroban arguments are positional, and two of them are BytesN<32>. Swap
    // order_id and basket_hash and everything type-checks, deploys, and then
    // settles against a basket nobody approved. Nothing else catches that, so
    // this reads the signature out of the contract and compares it.
    const src = await readFile(new URL('../../../../contracts/escrow/src/lib.rs', import.meta.url), 'utf8');
    const sig = /pub fn open\(\s*env: Env,([^)]*)\)/.exec(src);
    assert.ok(sig, 'could not find `pub fn open` in the escrow contract');

    const declared = sig[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(':').map((x) => x.trim()));

    assert.deepEqual(
      declared.map(([name]) => name),
      ['buyer', 'order_id', 'amount', 'basket_hash', 'timeout_secs'],
    );

    // And the Rust types the encoder is claiming to satisfy.
    assert.deepEqual(
      declared.map(([, type]) => type),
      ['Address', 'BytesN<32>', 'i128', 'BytesN<32>', 'u64'],
    );

    const bounds = /const MIN_TIMEOUT: u64 = (\d+);[\s\S]*?const MAX_TIMEOUT: u64 = ([^;]+);/.exec(src);
    assert.ok(bounds, 'could not find the timeout bounds');
    assert.equal(Number(bounds[1]), MIN_TIMEOUT_SECS);
    // `30 * 24 * 60 * 60` — evaluated rather than string-matched.
    assert.equal(
      bounds[2].split('*').reduce((n, x) => n * Number(x.trim()), 1),
      MAX_TIMEOUT_SECS,
    );
  });
});

describe('canonicalReceipt', () => {
  const input = {
    retailer: 'dia',
    cartId: 'abc-123',
    handoffUrl: 'https://diaonline.supermercadosdia.com.ar/checkout?orderFormId=abc-123',
    settledAt: '2026-09-20T14:30:00.000Z',
  };

  it('is verifiable: the preimage is plain text a person can read', () => {
    // The whole point of returning it from /api/settle. 32 bytes on a block
    // explorer prove nothing unless you can see what was hashed into them.
    assert.match(canonicalReceipt(input), /^changuito\/receipt\/v1\n/);
    assert.match(canonicalReceipt(input), /\nsettled\|2026-09-20T14:30:00\.000Z\n/);
  });

  it('survives a missing handoff url without shifting the other fields', () => {
    const lines = canonicalReceipt({ ...input, handoffUrl: undefined }).split('\n');
    assert.equal(lines[3], 'handoff|');
    assert.equal(lines[4], `settled|${input.settledAt}`);
  });

  it('hashes to 32 bytes, and a different moment is a different receipt', async () => {
    const a = await receiptHash(input);
    assert.equal(a.length, 32);
    const b = await receiptHash({ ...input, settledAt: '2026-09-20T14:30:01.000Z' });
    assert.notEqual(toHex(a), toHex(b));
  });

  it('is not the basket hash, even for the same cart', async () => {
    // Two BytesN<32> fields on the same order; a collision here would mean the
    // encoder was reusing one for the other.
    const receipt = toHex(await receiptHash(input));
    const basket = toHex(await basketHash(cart()));
    assert.notEqual(receipt, basket);
  });
});
