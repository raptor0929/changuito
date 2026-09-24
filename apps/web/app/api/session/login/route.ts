import { issueUserSession } from '../../../../lib/session-issue.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/session/login { address, proof }
 *
 * Called after Pollar login with a SEP-53 proof from the wallet. Sets the
 * signed httpOnly `chg_user` cookie that /api/chat reads. All of the checking
 * lives in lib/session-issue.ts.
 */
export function POST(req: Request): Promise<Response> {
  return issueUserSession(req);
}
