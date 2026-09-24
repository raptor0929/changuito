import { asNetwork, DEFAULT_NETWORK, type NetworkId } from './deployments.ts';
import { requireHuman } from './human-gate.ts';
import { denyNetwork } from './network-access.ts';
import type { SettleAction } from './order.ts';
import { proofFromBody, verifyWalletProof } from './wallet-proof-verify.ts';

/**
 * Everything POST /api/settle decides before it reads or signs anything.
 *
 * `settle` and `refund` are signed by the resolver key, and the route used to
 * sign them for anyone who knew an order id — and order ids are public in the
 * contract's `Opened` events. Now the caller must show a fresh SEP-53
 * signature from a wallet over a message naming the action *and* the order
 * (lib/wallet-proof.ts). The route then requires that wallet to be the
 * order's buyer as the contract records it (`buyerMayClose`).
 *
 * That leaves one trust decision, made on purpose: "I completed the basket"
 * is still the buyer's word, because the read-only MCP path cannot see the
 * store's order. It is safe because the only money a settle can move is the
 * buyer's own, into the treasury they were paying anyway, on their signature.
 * A third party can no longer settle or cancel someone else's purchase.
 *
 * The network arrives in the body too, and modo real is refused here for any
 * address outside the allowlist — *after* the signature, never before, so the
 * allowlist is read against an address that was proven rather than claimed.
 *
 * Its own module so the refusals can be tested as a route: the handler
 * imports the contract bindings, which cannot load under strip-types.
 */

const HEX32 = /^[0-9a-f]{64}$/;

export interface SettleRequest {
  action: SettleAction;
  orderId: string;
  /** Present on a settle. */
  basketHash: string;
  /** The wallet that signed, already verified. Still has to be the buyer. */
  address: string;
  /** Which chain this order lives on. Absent in the body means the default. */
  network: NetworkId;
}

export async function gateSettle(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<SettleRequest | Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  // Explicit. Anything that is not a known action used to be read as settle.
  if (body.action !== 'settle' && body.action !== 'refund') {
    return Response.json({ error: 'action must be settle or refund' }, { status: 400 });
  }
  const action: SettleAction = body.action;
  const orderId = typeof body.orderId === 'string' ? body.orderId.toLowerCase() : '';
  const basketHash = typeof body.basketHash === 'string' ? body.basketHash.toLowerCase() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';

  // Absent is the default; present-but-unknown is a mistake worth naming,
  // because silently falling back would settle on a chain nobody asked for.
  const network = body.network === undefined ? DEFAULT_NETWORK : asNetwork(body.network);
  if (network === null) {
    return Response.json({ error: 'network no reconocida' }, { status: 400 });
  }

  if (!HEX32.test(orderId)) {
    return Response.json({ error: 'orderId must be 32 bytes of hex' }, { status: 400 });
  }
  if (action === 'settle' && !HEX32.test(basketHash)) {
    return Response.json({ error: 'basketHash must be 32 bytes of hex' }, { status: 400 });
  }
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    return Response.json(
      { error: 'buyer_proof_required', message: 'Confirmá con la billetera que pagó la orden.' },
      { status: 401 },
    );
  }

  const verdict = verifyWalletProof({ intent: action, address, proof: proofFromBody(body), now, ref: orderId });
  if (!verdict.ok) {
    return Response.json(
      {
        error: verdict.error === 'proof_missing' ? 'buyer_proof_required' : 'buyer_proof_invalid',
        message: 'No pudimos confirmar que sos quien pagó la orden. Probá de nuevo.',
      },
      { status: 401 },
    );
  }

  // Last, and only now: the address above is proven, so the allowlist is being
  // asked about a wallet that really signed. A client-side toggle is a
  // courtesy; this is the wall.
  const denied = denyNetwork(address, network, env);
  if (denied) {
    return Response.json({ error: denied.error, message: denied.message }, { status: denied.status });
  }

  return { action, orderId, basketHash, address, network };
}

/** The last check, once the order is read: only its buyer may close it. */
export function buyerMayClose(orderBuyer: string, signer: string): boolean {
  return orderBuyer === signer;
}

export function notYourOrderResponse(): Response {
  return Response.json(
    { error: 'not_your_order', message: 'Esta orden no es de tu billetera.' },
    { status: 403 },
  );
}
