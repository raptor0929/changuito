/**
 * POST /api/settle  ->  release the escrow to the treasury, or return it.
 *
 * The resolver's half of the contract. `open` is signed by the buyer in their
 * wallet; `settle` and `refund` are signed here, by the one server key, because
 * the buyer must not be able to move money out of an escrow they funded.
 *
 * Who decides: only the order's buyer, proven by a SEP-53 signature over the
 * action and the order id, and checked against the buyer the contract
 * recorded. See lib/settle-gate.ts for why the buyer's word is enough here
 * and what a full product would add (the resolver checking the store).
 */
import { Status } from '@changuito/escrow-bindings';

import { canonicalReceipt, fromHex, receiptHash, toHex, type SettleAction } from '../../../lib/order.ts';
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
  const { action, orderId, basketHash, address } = gate;

  try {
    const escrow = escrowAsResolver();
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

    const amount = found.amount;
    const common = { action, orderId, amount: amount.toString(), amountDisplay: formatUsdc(amount) };

    if (action === 'refund') {
      const tx = await escrow.refund({ caller: (await escrow.config()).result.resolver, order_id: idBuf });
      const sent = await tx.signAndSend();
      const hash = sent.sendTransactionResponse?.hash ?? '';
      return Response.json({ ...common, hash, txUrl: explorer.tx(hash) } satisfies SettleResponse);
    }

    // Only what the contract returned and the server chose. Nothing the
    // browser sent is hashed as if it were evidence.
    const input = {
      orderId,
      buyer: String(found.buyer),
      basketHash,
      amountUnits: amount.toString(),
      settledAt: new Date().toISOString(),
    };
    const receipt = await receiptHash(input);

    const tx = await escrow.settle({
      order_id: idBuf,
      basket_hash: Buffer.from(fromHex(basketHash)),
      receipt_hash: Buffer.from(receipt),
    });
    const sent = await tx.signAndSend();
    const hash = sent.sendTransactionResponse?.hash ?? '';

    return Response.json({
      ...common,
      hash,
      txUrl: explorer.tx(hash),
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
