/**
 * GET /api/checkout/orders  ->  { orders: OrderLine[] }
 *
 * What this wallet has opened. The checkout store is the index (the chain
 * does not list a buyer's orders); each row is one order the buyer signed.
 */
import { ordersOf } from '../../../../lib/checkout/escrow-server.ts';
import type { OrderLine } from '../../../../lib/checkout/types.ts';
import { DEFAULT_NETWORK } from '../../../../lib/deployments.ts';
import { contractIds } from '../../../../lib/contract-ids.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';
import { explorer, formatUsdc } from '../../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión.' }, { status: 401 });
  try {
    const where = explorer.contract(contractIds(DEFAULT_NETWORK).escrowId);
    const orders: OrderLine[] = (await ordersOf(user.address)).slice(0, 50).map((o) => ({
      orderId: o.orderId,
      amountDisplay: formatUsdc(o.amount),
      status: o.status,
      openedAt: o.openedAt * 1000,
      explorer: where,
    }));
    return Response.json({ orders }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[checkout/orders]', err instanceof Error ? err.name : 'failed');
    return Response.json({ error: 'No pudimos leer tus compras.' }, { status: 502 });
  }
}
