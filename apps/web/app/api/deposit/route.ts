/**
 * POST /api/deposit  -> what to send, where, and with which memo.
 * GET  /api/deposit  -> has it landed yet.
 *
 * HTTP only. The quote, the confirmation, and the order row live in
 * `lib/pay/deposit-rail.ts`. Nothing in this file reads a chain or writes a
 * row.
 *
 * The mainnet rail holds no key. Preview is the only thing that pays for
 * anybody, and that payment is `POST /api/deposit/demo`, not this route.
 */
import { modeForSession } from '../../../lib/app-mode.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { readLoggedInUser } from '../../../lib/login-gate.ts';
import {
  confirmDeposit,
  quoteDeposit,
  type DepositIntent,
  type DepositStatus,
} from '../../../lib/pay/deposit-rail.ts';

export type { DepositIntent, DepositStatus };
export { depositAmount } from '../../../lib/pay/deposit-rail.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }

  // Mode and the cookie address are read here — the only place the server can
  // verify them — and handed to the rail. A signed-in testnet shopper owns
  // their deposit even though the gate needs no proof on that network.
  const user = await readLoggedInUser(req);
  const result = await quoteDeposit(body, {
    mode: modeForSession(user.ok),
    address: user.ok ? user.address : null,
  });
  return Response.json(result.body, { status: result.status });
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const q = new URL(req.url).searchParams;
  const result = await confirmDeposit({
    memo: q.get('memo') ?? '',
    amount: q.get('amount') ?? '',
    network: q.get('network'),
  });
  return Response.json(result.body, { status: result.status });
}
