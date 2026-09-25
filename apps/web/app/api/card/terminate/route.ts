/**
 * Give the card back.
 *
 * Irreversible, and always worth doing: Vyrion returns any residual to the
 * wallet the moment the card dies, and a card left alive is money sitting
 * where nobody is watching it. So this is called when the shopper says the
 * order is done, when they say it failed, and when they close the dialog —
 * the same `finally` shape `ephemeral-card.ts` puts around every payment.
 *
 * Safe to call twice, and answers the same way both times. "Already gone" is
 * the outcome the caller wanted, so it is not an error.
 */
import { canIssueCard, cardClient, heldCard } from '../../../../lib/card.ts';
import { isMemo } from '../../../../lib/deposit.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { memo?: unknown; network?: unknown };
  if (!isMemo(input.memo)) return json({ error: 'código inválido' }, 400);
  const network = networkFrom(input.network);

  if (!canIssueCard()) return json({ terminated: false }, 200);

  const cardId = await heldCard(network, input.memo).catch(() => undefined);
  if (!cardId) return json({ terminated: false }, 200);

  try {
    await cardClient().terminateCard(cardId);
    return json({ terminated: true }, 200);
  } catch (err) {
    // Worth shouting about in the server log: an un-terminated card still
    // holds money, and nothing else is going to notice.
    console.error(
      `[card] COULD NOT TERMINATE ${cardId} — terminate it by hand in the Vyrion dashboard:`,
      err instanceof Error ? err.message : String(err),
    );
    return json({ terminated: false }, 200);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
