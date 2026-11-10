/**
 * POST /api/settle  ->  release the escrow to the treasury, or return it.
 *
 * The resolver's half of the contract. `open` is signed by the buyer in their
 * wallet; `settle` and `refund` are authorized here by the one server key,
 * because the buyer must not be able to move money out of an escrow they
 * funded. The transaction itself is submitted through Channels: Channels is
 * the source and the fee payer. A Channels failure is not retried as a
 * resolver-paid or buyer-paid send.
 *
 * Who decides: only the order's buyer, proven by a SEP-53 signature over the
 * action and the order id, and checked against the buyer the contract
 * recorded. See lib/settle-gate.ts for why the buyer's word is enough here
 * and what a full product would add (the resolver checking the store).
 */
import { Status } from '@changuito/escrow-bindings';

import { channelsCloseDeps } from '../../../lib/checkout/escrow-server.ts';
import { canonicalReceipt, fromHex, receiptHash, toHex, type SettleAction } from '../../../lib/order.ts';
import { noteLanded, submitRefund, submitSettle } from '../../../lib/server/channels.ts';
import { escrowAsResolver } from '../../../lib/server/resolver.ts';
import { buyerMayClose, gateSettle, notYourOrderResponse } from '../../../lib/settle-gate.ts';
import { explorer, formatUsdc } from '../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface SettleResponse {
  action: SettleAction;
  orderId: string;
  /** The settle/refund transaction. */
  hash: string;
  txUrl: string;
  amount: string;
  amountDisplay: string;
  /** Present on a settle: the exact text `receipt_hash` was taken over. */
  receipt?: string;
  receiptHash?: string;
}

export async function POST(req: Request): Promise<Response> {
  const gate = await gateSettle(req);
  if (gate instanceof Response) return gate;
  const { action, orderId, basketHash, address, network } = gate;

  try {
    const escrow = escrowAsResolver(network);
    const idBuf = Buffer.from(fromHex(orderId));

    // Read first. The contract rejects all of these itself, but a simulation
    // panic reaches the browser as an XDR error code, and "this order was
    // already settled" is a thing a person can act on.
    const found = (await escrow.find_order({ order_id: idBuf })).result;
    if (!found) {
      return Response.json({ error: 'no existe una orden con ese id' }, { status: 404 });
    }
    // Before anything else is said about the order: a stranger learns
    // nothing about its state, and nobody but its buyer can move it.
    if (!buyerMayClose(String(found.buyer), address)) return notYourOrderResponse();
    if (found.status !== Status.Open) {
      return Response.json(
        { error: `la orden ya está ${found.status === Status.Settled ? 'liquidada' : 'reembolsada'}` },
        { status: 409 },
      );
    }
    if (action === 'settle' && toHex(new Uint8Array(found.basket_hash)) !== basketHash) {
      // The contract's BasketMismatch, caught early. If this fires, the browser
      // is settling against a basket other than the one it locked.
      return Response.json({ error: 'el carrito no coincide con el que firmó el comprador' }, { status: 409 });
    }

    // Channels serves testnet only. A network it does not cover is refused
    // here — never sent with the resolver as source.
    if (network !== 'testnet') {
      return Response.json({ error: 'Channels está disponible solo en testnet.' }, { status: 403 });
    }

    const amount = found.amount;
    const common = { action, orderId, amount: amount.toString(), amountDisplay: formatUsdc(amount) };
    const deps = await channelsCloseDeps();
    const buyer = String(found.buyer);

    if (action === 'refund') {
      const sent = await submitRefund({ orderId, buyer }, deps);
      await noteLanded(sent.hash, network);
      return Response.json({
        ...common,
        hash: sent.hash,
        txUrl: explorer.tx(sent.hash, network),
      } satisfies SettleResponse);
    }

    // Only what the contract returned and the server chose. Nothing the
    // browser sent is hashed as if it were evidence.
    const input = {
      orderId,
      buyer,
      basketHash,
      amountUnits: amount.toString(),
      settledAt: new Date().toISOString(),
    };
    const receipt = await receiptHash(input);

    const sent = await submitSettle(
      { orderId, basketHash, buyer },
      receipt,
      deps,
    );
    await noteLanded(sent.hash, network);

    return Response.json({
      ...common,
      hash: sent.hash,
      txUrl: explorer.tx(sent.hash, network),
      // Returned so the on-chain hash can be re-derived by anyone, which is
      // the only thing that makes it a receipt rather than 32 opaque bytes.
      receipt: canonicalReceipt(input),
      receiptHash: toHex(receipt),
    } satisfies SettleResponse);
  } catch (err) {
    // The detail (RPC URLs, XDR codes) stays in the log.
    console.error('[settle] failed:', err);
    return Response.json({ error: 'No pudimos cerrar la orden. Probá de nuevo en un momento.' }, { status: 502 });
  }
}
