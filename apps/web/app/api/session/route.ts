/**
 * GET /api/session -> { address } or { address: null }.
 *
 * The cookie is httpOnly, so the page cannot read it. A missing or expired
 * cookie is `null`, not an error.
 */
import { readLoggedInUser } from '../../../lib/login-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(req: Request): Promise<Response> {
  const who = await readLoggedInUser(req);
  return Response.json({ address: who.ok ? who.address : null }, { headers: NO_STORE });
}
