/**
 * The code the súper's bank sends to a card that has no phone.
 *
 * A 3DS challenge normally goes to the cardholder's mobile. This card's holder
 * is us, so the code arrives at Vyrion and has to be put in front of the
 * shopper before it expires — roughly three minutes, which is why the panel
 * counts down rather than just showing it.
 *
 * Keyed on the código, never on a card id. The card id is a bearer credential
 * for somebody's PAN; the código is already checked against the ledger and is
 * what the rest of the flow speaks. So the browser sends what it has and the
 * server looks up which card that deposit bought.
 *
 * `seen` carries the ids the shopper has already been shown. It is
 * `pickChallenge`'s `Set` from packages/mcp/src/pay/ephemeral-card.ts, moved
 * into the request because a serverless handler has no memory between polls —
 * and it exists for the same reason: showing a stale code twice sends someone
 * back to a form that will reject it.
 */
import { canIssueCard, cardClient, heldCard } from '../../../../lib/card.ts';
import { isMemo } from '../../../../lib/deposit.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Derived rather than imported: `@changuito/mcp/pay` exports the client, not
 *  the wire types, and one inferred alias is cheaper than widening that entry
 *  point for a single field list. */
type Challenge = Awaited<ReturnType<ReturnType<typeof cardClient>['threeDsChallenges']>>[number];

export interface ThreeDsCode {
  id: string;
  otp: string;
  merchant: string;
  /** Epoch millis, so the countdown is the browser's clock against a fixed point. */
  expiresAt: number | null;
}

function networkFrom(value: string | null): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const url = new URL(req.url);
  const memo = url.searchParams.get('memo');
  if (!isMemo(memo)) return json({ error: 'código inválido' }, 400);
  const network = networkFrom(url.searchParams.get('network'));

  if (!canIssueCard()) return json({ code: null }, 200);

  const cardId = await heldCard(network, memo).catch(() => undefined);
  // No card for this código is not an error: the shopper may be paying with
  // their own, in which case nothing will ever arrive here.
  if (!cardId) return json({ code: null }, 200);

  const seen = new Set(
    (url.searchParams.get('seen') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  let list: Challenge[];
  try {
    list = await cardClient().threeDsChallenges(cardId);
  } catch (err) {
    // A failed poll is a poll, not a verdict. `ephemeral-card.ts` swallows the
    // same way — the loop is going to ask again in three seconds.
    console.error('[3ds] poll failed:', err instanceof Error ? err.message : String(err));
    return json({ code: null }, 200);
  }

  return json({ code: pick(list, seen) }, 200);
}

/** Newest unused challenge that has not expired — `pickChallenge`, verbatim in
 *  its rules, with the `seen` set arriving from the caller instead of a field. */
function pick(list: Challenge[], seen: Set<string>): ThreeDsCode | null {
  const usable = list
    .filter((c) => c.otp && !seen.has(c.id))
    .filter((c) => !c.expires_at || Date.parse(c.expires_at) > Date.now())
    .filter((c) => !c.status || !/used|expired|cancel/i.test(c.status));
  const hit = usable.sort((a, b) => (a.expires_at ?? '').localeCompare(b.expires_at ?? '')).at(-1);
  if (!hit) return null;
  const expiresAt = hit.expires_at ? Date.parse(hit.expires_at) : NaN;
  return {
    id: hit.id,
    otp: hit.otp,
    merchant: hit.merchant ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    // An OTP in a cache is an OTP somebody else can read.
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
