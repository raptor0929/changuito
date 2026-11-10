import { channelsClient, channelsKey, noteLanded, prepareOpen, stellarSimulator, submitOpen, type OpenFields } from '../../../../lib/server/channels.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prepare and submit `escrow.open` through OpenZeppelin Channels.
 * The buyer signs an auth entry; the fee is paid by a Channels account.
 * `func` in the body is ignored: the server rebuilds the call.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await readSessionUser(req);
  if (!session.ok && session.mismatch) return sessionMismatchResponse(req);
  if (!session.ok) return Response.json({ error: 'Iniciá sesión para pagar.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const input = fields(body);
  if (!input) return Response.json({ error: 'bad request' }, { status: 400 });
  const step = body?.step;
  try {
    const deps = {
      apiKey: channelsKey(),
      simulator: stellarSimulator('testnet'),
      client: await channelsClient(),
    };
    if (step === 'prepare') {
      const prepared = await prepareOpen(input, session.address, deps);
      if (prepared.kind === 'opened') return Response.json({ hash: prepared.hash });
      return Response.json({
        entries: prepared.entries,
        validUntilLedger: prepared.validUntilLedger,
      });
    }
    if (step === 'submit') {
      const signed = Array.isArray(body?.auth) ? body.auth.filter((entry: unknown) => typeof entry === 'string') : [];
      const sent = await submitOpen(input, session.address, signed, deps);
      await noteLanded(sent.hash);
      return Response.json({ hash: sent.hash });
    }
    return Response.json({ error: 'bad request' }, { status: 400 });
  } catch (err) {
    const status = err instanceof Error && 'status' in err && typeof err.status === 'number' ? err.status : 500;
    const code = err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : 'channels_submit';
    const message = err instanceof Error ? err.message : 'No se pudo enviar el pago.';
    const hash = err instanceof Error && 'hash' in err && typeof err.hash === 'string' ? err.hash : undefined;
    return Response.json({ error: message, code, hash }, { status });
  }
}

function fields(body: { [key: string]: unknown } | null): OpenFields | null {
  if (!body) return null;
  const { orderId, amount, basketHash, timeoutSecs, contractId, method, network } = body;
  if (typeof orderId !== 'string' || typeof amount !== 'string' || typeof basketHash !== 'string') return null;
  if (typeof contractId !== 'string' || typeof method !== 'string' || typeof network !== 'string') return null;
  if (typeof timeoutSecs !== 'number') return null;
  return { orderId, amount, basketHash, timeoutSecs, contractId, method, network };
}
