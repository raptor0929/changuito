/**
 * POST /api/settle  ->  release the escrow to the treasury, or return it.
 *
 * The resolver's half of the contract. `open` is signed by the buyer in their
 * wallet; `settle` and `refund` are signed here, by the one server key, because
 * the buyer must not be able to move money out of an escrow they funded.
 *
 * Who decides: in a full product the resolver would settle from its own
 * confirmation with the store, never from the browser's word. changuito's
 * read-only MCP path stops at the cart link, so the user tells us whether they
 * completed it. That is fine for a demo where the money is test USDC and the
 * only account that can be hurt is the caller's own; it would not be fine in a
 * real deployment, and the fix is that the resolver checks the store itself.
 */
import { Status } from '@changuito/escrow-bindings';

import { canonicalReceipt, fromHex, receiptHash, toHex, type SettleAction } from '../../../lib/order.ts';
import { escrowAsResolver } from '../../../lib/server/resolver.ts';
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

const HEX32 = /^[0-9a-f]{64}$/;

export async function POST(req: Request): Promise<Response> {
  let body: {
    orderId?: unknown;
    basketHash?: unknown;
    action?: unknown;
    retailer?: unknown;
    cartId?: unknown;
    handoffUrl?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const action: SettleAction = body.action === 'refund' ? 'refund' : 'settle';
  const orderId = typeof body.orderId === 'string' ? body.orderId.toLowerCase() : '';
  const basketHash = typeof body.basketHash === 'string' ? body.basketHash.toLowerCase() : '';
  if (!HEX32.test(orderId)) {
    return Response.json({ error: 'orderId must be 32 bytes of hex' }, { status: 400 });
  }
  if (action === 'settle' && !HEX32.test(basketHash)) {
    return Response.json({ error: 'basketHash must be 32 bytes of hex' }, { status: 400 });
  }

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

    const settledAt = new Date().toISOString();
    const input = {
      retailer: typeof body.retailer === 'string' ? body.retailer : '',
      cartId: typeof body.cartId === 'string' ? body.cartId : '',
      handoffUrl: typeof body.handoffUrl === 'string' ? body.handoffUrl : undefined,
      settledAt,
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
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `no pudimos cerrar la orden: ${message}` }, { status: 502 });
  }
}
