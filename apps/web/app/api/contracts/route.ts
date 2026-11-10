/**
 * GET /api/contracts?network=testnet  ->  { network, escrowId, usdcId }
 *
 * The ids the shopper's wallet will call. Read here, on the request, from the
 * Worker runtime variables. They are public contract ids. They are not baked
 * into the client bundle, so changing the variable does not take a rebuild.
 */
import { contractIds } from '../../../lib/contract-ids.ts';
import { asNetwork } from '../../../lib/deployments.ts';
import { requireHuman } from '../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const net = asNetwork(new URL(req.url).searchParams.get('network'));
  if (!net) {
    return Response.json({ error: 'network must be testnet or mainnet' }, { status: 400 });
  }

  try {
    const ids = contractIds(net);
    return Response.json(
      { network: net, escrowId: ids.escrowId, usdcId: ids.usdcId },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 404 });
  }
}
