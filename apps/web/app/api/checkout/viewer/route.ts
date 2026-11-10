import { ownedManual } from '../../../../lib/checkout/manual-auth.ts';
import { manualMember, sandboxRequest } from '../../../../lib/checkout/manual-server.ts';
import { viewerBody, viewerGrant } from '../../../../lib/checkout/flow.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const got = await ownedManual(req);
  if (!got.ok) return got.response;
  const { rec } = got;
  if (!rec.jobId || !rec.manual?.sessionActive || (rec.manual.viewerExpiresAt ?? 0) <= Date.now()) {
    return Response.json({ error: 'La sesión no está disponible.' }, { status: 409 });
  }
  if (!await manualMember(rec.buyer)) return Response.json({ error: 'Acceso no autorizado.' }, { status: 403 });
  const grant = viewerGrant(rec.manualFlow, got.part);
  try {
    const response = await sandboxRequest(`/jobs/${rec.jobId}/ticket`, { purpose: grant.purpose });
    if (!response.ok) throw new Error('session unavailable');
    const result = await response.json();
    const base = process.env.SANDBOX_URL;
    if (!base) throw new Error('session unavailable');
    const payload = viewerBody(rec.manualFlow, got.part, {
      ticket: result.ticket, cardToken: result.cardToken, jobId: rec.jobId, expiresAt: rec.manual.viewerExpiresAt,
    }, base);
    if (!payload) throw new Error('invalid grant');
    return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'No pudimos conectar el navegador.' }, { status: 503 }); }
}
