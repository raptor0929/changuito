/**
 * One card, one basket, funded by one deposit.
 *
 * The chain of custody is the whole route: a código arrives, the ledger is read
 * for a payment carrying it, the amount comes from that payment, the deposit is
 * claimed exactly once, and a card is created for that amount and no more.
 * Nothing in the request body reaches the card except the código — and the
 * código is checked against a public ledger before it buys anything.
 *
 * Four ceilings, the same four packages/mcp/src/pay/ephemeral-card.ts sets:
 * funded with the order and nothing more, `spending_limit` equal to it so the
 * FX buffer cannot be spent, grocery MCCs only, and terminated when the shopper
 * says the order is done.
 *
 * ## Why it answers twice with the same card
 *
 * A shopper who refreshes must see the card they already have, not an error
 * about a card they do not remember asking for. So the claim is checked before
 * anything is created, and if a second tab wins the race in between, the card
 * this request made is terminated at once — leaving it alive would strand the
 * money inside it — and the winner's card is returned instead.
 *
 * The response carries the PAN and the CVV, because the shopper has to type
 * them into the súper's form and there is no other way for them to arrive.
 * They are `no-store`, they are never logged, and lib/card.ts says the rest.
 *
 * ## Why this asks for no signature
 *
 * On a gated network `POST /api/deposit` already made the shopper sign, and
 * this route checks that the memo belongs to the wallet that signed. It does
 * **not** ask for a second signature, and that is a decision rather than an
 * omission: a proof lives five minutes (`WALLET_PROOF_TTL_MS`) and a deposit
 * can take longer than that to confirm, so requiring one here would refuse a
 * shopper who has already sent real money — the worst available moment to
 * fail, and one that ends in a refund done by hand.
 *
 * So the memo stays the credential at this step, which is exactly why
 * `mintMemo` draws from the CSPRNG and why lib/card.ts is careful about what
 * the depositor record does and does not prove.
 */
import { CARD_MAX_CENTS, CARD_MIN_CENTS, formatUsd } from '@changuito/mcp/pay';

import {
  canIssueCard,
  cardClient,
  claimDeposit,
  depositorOf,
  fundingFor,
  heldCard,
  refuseFunding,
} from '../../../lib/card.ts';
import { depositAddress, isMemo } from '../../../lib/deposit.ts';
import { realModeFor, realModeNeedsProof } from '../../../lib/deposit-gate.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../lib/deployments.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { networkAccess } from '../../../lib/network-access.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface IssuedCard {
  cardId: string;
  last4: string;
  /** visa / mastercard — the logo the súper's form expects. */
  brand: string;
  pan: string;
  cvv: string;
  /** Two digits, as the form wants them. */
  expiryMonth: string;
  /** Two digits; Vyrion sends four. */
  expiryYear: string;
  holder: string;
  fundedDisplay: string;
}

/** The categories a grocery order can legitimately land in. Same default as
 *  packages/mcp/src/config.ts, and the same env var, so the two cannot drift. */
const GROCERY_MCC = (process.env.ALLOWED_MCC ?? '5411,5499,5311')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  if (!canIssueCard()) {
    // Not an error the shopper caused and not one they can act on. The UI does
    // not offer the button in this state; this is the second lock.
    return json({ error: 'las tarjetas no están habilitadas en este entorno' }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { memo?: unknown; network?: unknown };

  if (!isMemo(input.memo)) return json({ error: 'código inválido' }, 400);
  const memo = input.memo;
  const network = networkFrom(input.network);
  const address = depositAddress(network);
  if (!address) return json({ error: 'los pagos no están habilitados en este entorno' }, 503);

  // The deposit was opened by somebody the gate let in — or this is a memo
  // nothing recognises. Skipped in mode 'open', where nothing was proven at
  // deposit time either and there is no play money worth binding.
  const mode = realModeFor(network);
  if (realModeNeedsProof(mode)) {
    const owner = await depositorOf(network, memo).catch(() => undefined);
    if (!owner) {
      // Either a forged código or a record we lost. Refusing is the recoverable
      // side of that choice: the shopper can still pay with their own card at
      // the store, and an importe that was really sent is refunded by hand.
      console.error(`[card] no depositor recorded for ${network}:${memo}`);
      return json({ error: 'no pudimos verificar este importe' }, 403);
    }
    // Re-read rather than trusted: an allowlist can shrink between the deposit
    // and the card, and the second question is the one being answered now.
    if (!networkAccess(owner, network).allowed) {
      return json({ error: 'Esta cuenta no tiene habilitado el modo real.' }, 403);
    }
  }

  const client = cardClient();

  // Already minted for this código — a refresh, a second tab, a back button.
  const already = await heldCard(network, memo).catch(() => undefined);
  if (already) return describe(client, already, 200);

  let funding;
  try {
    funding = await fundingFor(network, memo, address);
  } catch (err) {
    // An unreadable ledger is not "no deposit". Saying otherwise would tell a
    // shopper who has already paid that they have not — the same rule the
    // deposit route keeps.
    console.error('[card] horizon read failed:', message(err));
    return json({ error: 'no pudimos consultar la red en este momento' }, 502);
  }
  if (!funding) return json({ error: 'todavía no vemos el importe de esta compra' }, 409);

  const refusal = refuseFunding(funding.cents);
  if (refusal) {
    return json(
      {
        error:
          refusal === 'too-small'
            ? `el importe es menor al mínimo de una tarjeta (${formatUsd(CARD_MIN_CENTS)})`
            : `el importe supera el máximo de una tarjeta (${formatUsd(CARD_MAX_CENTS)})`,
      },
      409,
    );
  }

  try {
    const bins = await client.bins();
    // bins() has already dropped anything without 3DS and sorted by acceptance.
    // An empty list is an account problem, not a shopper one.
    const bin = bins[0];
    if (!bin) {
      console.error('[card] no 3DS-capable BIN available on this Vyrion account');
      return json({ error: 'no pudimos emitir una tarjeta en este momento' }, 502);
    }

    const card = await client.createCard({
      binId: bin.id,
      amountCents: funding.cents,
      label: `changuito ${memo}`,
      // Equal to the funded amount: the FX buffer is float, not spend.
      spendingLimitCents: funding.cents,
      allowedCategories: GROCERY_MCC,
      metadata: { memo, network, tx: funding.txHash },
    });

    const claim = await claimDeposit(network, memo, card.id, funding.cents);
    if (!claim.claimed) {
      // Lost the race. This card is not the one the deposit owns, so it goes
      // back immediately; the winner's is what the shopper asked for.
      await client.terminateCard(card.id).catch((e) => {
        console.error(`[card] could not terminate the losing card ${card.id}:`, message(e));
      });
      if (claim.existing) return describe(client, claim.existing, 200);
      return json({ error: 'este importe ya tiene una tarjeta' }, 409);
    }

    return json(await issued(client, card.id, card.last4, card.network, funding.cents), 200);
  } catch (err) {
    // Deliberately not the upstream message: a card API's errors can quote the
    // request back, and the request had a card in it.
    console.error('[card] issue failed:', message(err));
    return json({ error: 'no pudimos emitir una tarjeta en este momento' }, 502);
  }
}

/** The card a claim already points at, read back in full. */
async function describe(
  client: ReturnType<typeof cardClient>,
  cardId: string,
  status: number,
): Promise<Response> {
  try {
    const card = await client.getCard(cardId);
    if (card.status === 'terminated') {
      // The order is over. Re-minting would spend a deposit that is already
      // spent, so this is the end of the road rather than a retry.
      return json({ error: 'la tarjeta de esta compra ya se cerró' }, 409);
    }
    // `spending_limit`, not `balance`: they are the same figure at birth and
    // the balance drops the moment the súper authorises. The panel's sentence
    // is about what the card was funded with, so it has to read the number
    // that does not move.
    const funded = Math.round((card.spending_limit ?? card.balance ?? 0) * 100);
    return json(await issued(client, card.id, card.last4, card.network, funded), status);
  } catch (err) {
    console.error('[card] could not read back the held card:', message(err));
    return json({ error: 'no pudimos leer la tarjeta de esta compra' }, 502);
  }
}

async function issued(
  client: ReturnType<typeof cardClient>,
  cardId: string,
  last4: string,
  brand: string,
  cents: number,
): Promise<IssuedCard> {
  const d = await client.cardDetails(cardId);
  return {
    cardId,
    last4,
    brand,
    pan: d.pan,
    cvv: d.cvv,
    expiryMonth: d.expiry_month,
    // Vyrion sends four digits; most forms want two.
    expiryYear: d.expiry_year.slice(-2),
    holder: d.cardholder_name ?? 'CHANGUITO',
    fundedDisplay: formatUsd(cents),
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    // Not a cache, not a proxy, not a back button.
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
