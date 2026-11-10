/**
 * Rebuild an escrow order from contract events without decoding a ledger header.
 *
 * SDK 17.1 cannot simulate `find_order` against protocol 30 ledger entries.
 * Raw JSON-RPC `getEvents` still works: the payload is a plain ScVal, the same
 * shape Channels uses for an `opened` transaction hash.
 */
import { Buffer } from 'node:buffer';

import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { contractIds } from '../contract-ids.ts';
import { DEFAULT_TIMEOUT_SECS, fromHex, toHex } from '../order.ts';
import { rpcUrl } from '../rpc-url.ts';
import type { OrderAccount } from './escrow-server.ts';

/** One contract event row as Soroban RPC returns it. */
export interface EscrowEventRow {
  topic?: unknown;
  value?: unknown;
}

const ZERO = '00'.repeat(32);

async function rpcCall(url: string, method: string, params: unknown): Promise<{ [key: string]: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json() as { result?: { [key: string]: unknown }; error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? 'rpc');
  return json.result ?? {};
}

function topicSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = scValToNative(xdr.ScVal.fromXDR(raw, 'base64'));
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function topicAddress(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = scValToNative(xdr.ScVal.fromXDR(raw, 'base64'));
    if (typeof v === 'string' && v.length > 0) return v;
    if (v instanceof Address) return v.toString();
  } catch {
    /* not an address topic */
  }
  return null;
}

/**
 * `opened` carries amount, basket and deadline; a later `settled` or
 * `refunded` for the same id wins the status.
 */
export function orderFromEscrowEvents(orderIdHex: string, events: EscrowEventRow[]): OrderAccount | null {
  let opened: {
    buyer: string;
    amount: bigint;
    basketHash: string;
    deadline: number;
  } | null = null;
  let status: OrderAccount['status'] = 'open';
  let receiptHash = ZERO;

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const topics = Array.isArray(ev.topic) ? ev.topic : [];
    const name = topicSymbol(topics[0]);
    if (name !== 'opened' && name !== 'settled' && name !== 'refunded') continue;
    if (typeof ev.value !== 'string') continue;

    let value: {
      amount?: bigint;
      basket_hash?: Uint8Array;
      deadline?: bigint | number;
      receipt_hash?: Uint8Array;
    };
    try {
      value = scValToNative(xdr.ScVal.fromXDR(ev.value, 'base64')) as typeof value;
    } catch {
      continue;
    }

    const buyer = topicAddress(topics[2]);
    if (name === 'opened') {
      const basket = value.basket_hash ? toHex(new Uint8Array(value.basket_hash)) : '';
      if (!buyer || value.amount == null || !basket || value.deadline == null) continue;
      opened = {
        buyer,
        amount: BigInt(value.amount.toString()),
        basketHash: basket,
        deadline: Number(value.deadline),
      };
      if (status === 'open') receiptHash = ZERO;
      continue;
    }

    if (!opened && buyer && value.amount != null) {
      opened = {
        buyer,
        amount: BigInt(value.amount.toString()),
        basketHash: ZERO,
        deadline: 0,
      };
    }
    if (name === 'settled') {
      status = 'settled';
      receiptHash = value.receipt_hash ? toHex(new Uint8Array(value.receipt_hash)) : ZERO;
    } else if (name === 'refunded') {
      status = 'refunded';
      receiptHash = ZERO;
    }
  }

  if (!opened) return null;
  return {
    orderId: orderIdHex,
    buyer: opened.buyer,
    amount: opened.amount,
    basketHash: opened.basketHash,
    status,
    openedAt: Math.max(0, opened.deadline - DEFAULT_TIMEOUT_SECS),
    deadline: opened.deadline,
    receiptHash,
  };
}

/** Fetch recent escrow events for this order id and rebuild the account. */
export async function readOrderFromEvents(orderIdHex: string): Promise<OrderAccount | null> {
  const url = rpcUrl('testnet');
  const escrowId = contractIds('testnet').escrowId;
  const latest = await rpcCall(url, 'getLatestLedger', {});
  const sequence = typeof latest.sequence === 'number' ? latest.sequence : 0;
  if (!sequence) return null;

  const orderTopic = nativeToScVal(Buffer.from(fromHex(orderIdHex)), { type: 'bytes' }).toXDR('base64');
  const result = await rpcCall(url, 'getEvents', {
    startLedger: Math.max(1, sequence - 2_000),
    filters: [{
      type: 'contract',
      contractIds: [escrowId],
      topics: [['*', orderTopic]],
    }],
    pagination: { limit: 10 },
  });
  const events = Array.isArray(result.events) ? result.events as EscrowEventRow[] : [];
  return orderFromEscrowEvents(orderIdHex, events);
}
