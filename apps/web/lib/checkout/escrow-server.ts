/**
 * The resolver's side of the escrow, on Stellar.
 *
 * Read an order, settle it to the treasury, refund it to the buyer. Every
 * write checks the chain first, so a poll that arrives twice cannot settle
 * twice — the contract refuses a second close anyway.
 *
 * The browser opens the order (the buyer has to sign). Settle and refund are
 * authorized by the resolver on the server and submitted through Channels:
 * Channels is the transaction source and the fee payer. This module never
 * builds a buyer-paid close, and a failed Channels submit is not retried as
 * a direct RPC send.
 *
 * Purchases that are not on chain yet are read back from the checkout store,
 * which is what the shopper just paid into.
 */
import { Buffer } from 'node:buffer';

import { fromHex, toHex } from '../order.ts';
import { checkoutStore, type CheckoutRecord } from './store.ts';

export interface OrderAccount {
  orderId: string;
  buyer: string;
  amount: bigint;
  basketHash: string;
  status: 'open' | 'settled' | 'refunded';
  openedAt: number;
  deadline: number;
  receiptHash: string;
}

const ZERO = '00'.repeat(32);

function fromRecord(rec: CheckoutRecord): OrderAccount {
  const openedAt = Math.floor(rec.createdAt / 1000);
  const status = rec.outcome === 'settled' ? 'settled' : rec.outcome === 'refunded' ? 'refunded' : 'open';
  return {
    orderId: rec.orderId,
    buyer: rec.buyer,
    amount: BigInt(rec.amount),
    basketHash: rec.basketHash,
    status,
    openedAt,
    deadline: openedAt + 3600,
    receiptHash: ZERO,
  };
}

function asOrder(orderId: string, raw: {
  buyer: string;
  amount: bigint | { toString(): string };
  basket_hash: Uint8Array;
  status: number | string;
  opened_at: bigint | number;
  deadline: bigint | number;
  receipt_hash: Uint8Array;
}): OrderAccount {
  const status = raw.status === 1 || raw.status === 'Settled' ? 'settled'
    : raw.status === 2 || raw.status === 'Refunded' ? 'refunded' : 'open';
  return {
    orderId,
    buyer: raw.buyer,
    amount: BigInt(raw.amount.toString()),
    basketHash: toHex(new Uint8Array(raw.basket_hash)),
    status,
    openedAt: Number(raw.opened_at),
    deadline: Number(raw.deadline),
    receiptHash: toHex(new Uint8Array(raw.receipt_hash)),
  };
}

function unwrapOrder(value: unknown): {
  buyer: string;
  amount: bigint;
  basket_hash: Uint8Array;
  status: number | string;
  opened_at: bigint | number;
  deadline: bigint | number;
  receipt_hash: Uint8Array;
} | null {
  if (value == null) return null;
  if (typeof value === 'object' && value !== null && 'buyer' in value) return value as never;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    if (inner && typeof inner === 'object' && 'buyer' in inner) return inner as never;
  }
  return null;
}

export async function readOrder(orderIdHex: string): Promise<OrderAccount | null> {
  try {
    const { escrowAsResolver } = await import('../server/resolver.ts');
    const tx = await escrowAsResolver().find_order({ order_id: Buffer.from(fromHex(orderIdHex)) });
    const found = unwrapOrder(tx.result);
    if (found) return asOrder(orderIdHex, found);
  } catch (err) {
    console.warn('[escrow] read failed', err instanceof Error ? err.name : 'failed');
  }
  const rec = await checkoutStore().get(orderIdHex);
  return rec?.openSig ? fromRecord(rec) : null;
}

async function channelsCloseDeps() {
  const {
    ChannelsFailure,
    channelsClient,
    channelsKey,
    stellarSimulator,
  } = await import('../server/channels.ts');
  const { resolverKeypair } = await import('../server/resolver.ts');
  const { deployment } = await import('../deployments.ts');
  const apiKey = channelsKey();
  const client = await channelsClient();
  if (!apiKey || !client) {
    throw new ChannelsFailure(503, 'channels_unconfigured', 'Los pagos no están habilitados.');
  }
  const net = 'testnet' as const;
  return {
    apiKey,
    client,
    simulator: stellarSimulator(net),
    resolver: resolverKeypair(net),
    networkPassphrase: deployment(net).networkPassphrase,
  };
}

export async function settleOrder(order: OrderAccount, receiptHash: Uint8Array): Promise<string> {
  const { submitSettle, noteLanded } = await import('../server/channels.ts');
  const deps = await channelsCloseDeps();
  const sent = await submitSettle(
    { orderId: order.orderId, basketHash: order.basketHash, buyer: order.buyer },
    receiptHash,
    deps,
  );
  await noteLanded(sent.hash);
  return sent.hash;
}

export async function refundOrder(order: OrderAccount): Promise<string> {
  const { submitRefund, noteLanded } = await import('../server/channels.ts');
  const deps = await channelsCloseDeps();
  const sent = await submitRefund(
    { orderId: order.orderId, buyer: order.buyer },
    deps,
  );
  await noteLanded(sent.hash);
  return sent.hash;
}

/** Orders this wallet has opened, newest first. The checkout store is the index; the chain is the balance. */
export async function ordersOf(buyer: string): Promise<OrderAccount[]> {
  const rows = await checkoutStore().listByBuyer(buyer);
  return rows
    .filter((rec) => Boolean(rec.openSig))
    .map(fromRecord)
    .sort((a, b) => b.openedAt - a.openedAt);
}
