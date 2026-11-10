/**
 * POST /api/sponsor
 *
 * Classic sponsored account + Circle testnet USDC trustline. Changuito's
 * sponsor account builds and co-signs; the shopper signs only their ops in
 * Freighter; the sponsor submits via Horizon and pays the fee.
 *
 * Channels cannot submit a classic sponsorship envelope (its API is
 * `submitSorobanTransaction` only), so this route never sends the buyer as
 * fee source and never turns on Pollar fee/reserve sponsorship.
 *
 *   { step: 'prepare', address, proof, network? }
 *     → { status: 'ready' }                         already sponsored
 *     → { status: 'sign', xdr, networkPassphrase, need, sponsor }
 *
 *   { step: 'submit', address, proof, signedXdr, network? }
 *     → { status: 'ready' }                         already sponsored (no-op)
 *     → { hash, need }
 */
import { gateSponsor } from '../../../lib/sponsor-gate.ts';
import { liveSponsorDeps, prepareSponsorship, submitSponsorship, SponsorTxError } from '../../../lib/sponsor-flow.ts';
import { canSponsor, sponsorKeypair } from '../../../lib/server/sponsor-wallet.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const gate = await gateSponsor(req);
  if (gate instanceof Response) return gate;
  const { address, network, step, signedXdr } = gate;

  if (network !== 'testnet') {
    return Response.json(
      { error: 'sponsor_testnet_only', message: 'El sponsorship de reservas está disponible solo en testnet.' },
      { status: 403 },
    );
  }

  if (!canSponsor()) {
    console.error('[sponsor] STELLAR_SPONSOR_SECRET is not set');
    return Response.json({ error: 'sponsor_unavailable', message: 'El sponsorship no está habilitado.' }, { status: 503 });
  }

  try {
    const deps = liveSponsorDeps(sponsorKeypair());
    if (step === 'prepare') {
      const prepared = await prepareSponsorship(address, network, deps);
      if (prepared.status === 'ready') {
        return Response.json({ status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
      }
      return Response.json(
        {
          status: 'sign',
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
          need: prepared.need,
          sponsor: prepared.sponsor,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const sent = await submitSponsorship(address, network, signedXdr!, deps);
    if ('status' in sent && sent.status === 'ready') {
      return Response.json({ status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json(sent, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof SponsorTxError) {
      return Response.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error('[sponsor] failed:', err instanceof Error ? err.message : String(err));
    return Response.json(
      { error: 'sponsor_failed', message: 'No pudimos completar el sponsorship. Probá de nuevo.' },
      { status: 502 },
    );
  }
}
