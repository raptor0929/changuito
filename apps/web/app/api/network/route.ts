/**
 * GET /api/network?address=G…  ->  { testnet?: {…}, mainnet?: {…} }
 *
 * Whether this wallet may use each *served* network. Only networks this
 * deployment answers for appear in the body — with the testnet Pollar key
 * set, that is `{ testnet: … }` alone. A browser that asks about mainnet
 * learns nothing it can use to reach a chain we do not serve.
 *
 * This is a courtesy, not a boundary. The wall is in lib/settle-gate.ts, which
 * asks the same question of an address that has proven itself with a
 * signature. A browser that lies to this route learns nothing it can use.
 */
import type { NetworkId } from '../../../lib/deployments.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { networkAccess, type NetworkAccess } from '../../../lib/network-access.ts';
import { servedNetworks } from '../../../lib/server-network.ts';
import { addressKind } from '../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type NetworkAccessMap = Partial<Record<NetworkId, NetworkAccess>>;

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const address = new URL(req.url).searchParams.get('address') ?? '';
  // A smart wallet (C…) is a valid address that can never be on the list,
  // because it cannot sign SEP-53. It gets a real answer, which is "no".
  const known = addressKind(address) !== null ? address : '';

  const body = Object.fromEntries(
    servedNetworks().map((net) => [net, networkAccess(known, net)]),
  ) as NetworkAccessMap;

  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
