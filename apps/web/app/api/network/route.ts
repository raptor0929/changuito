/**
 * GET /api/network?address=G…  ->  { testnet: {…}, mainnet: {…} }
 *
 * Whether this wallet may switch into modo real, so the toggle can explain
 * itself instead of offering a position that can only fail. Every network in
 * one answer: the toggle needs them all and the read is free.
 *
 * This is a courtesy, not a boundary. The wall is in lib/settle-gate.ts, which
 * asks the same question of an address that has proven itself with a
 * signature. A browser that lies to this route learns nothing it can use.
 */
import { NETWORK_IDS, type NetworkId } from '../../../lib/deployments.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { networkAccess, type NetworkAccess } from '../../../lib/network-access.ts';
import { addressKind } from '../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type NetworkAccessMap = Record<NetworkId, NetworkAccess>;

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const address = new URL(req.url).searchParams.get('address') ?? '';
  // A smart wallet (C…) is a valid address that can never be on the list,
  // because it cannot sign SEP-53. It gets a real answer, which is "no".
  const known = addressKind(address) !== null ? address : '';

  const body = Object.fromEntries(
    NETWORK_IDS.map((net) => [net, networkAccess(known, net)]),
  ) as NetworkAccessMap;

  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
