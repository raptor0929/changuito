/**
 * POST /api/deposit  -> what to send, where, and with which memo.
 * GET  /api/deposit  -> has it landed yet.
 *
 * The whole payment rail, and it holds no state. A deposit is a plain Stellar
 * payment to an operator account with a memo on it, so "has the shopper paid"
 * is a question the public ledger answers and neither a database nor a webhook
 * is involved. The browser keeps the memo it was given and asks again.
 *
 * Nothing here can move money. There is no secret key in this deployment and
 * no outbound path: the server reads Horizon and reports. A refund is a human
 * doing it by hand, which is a worse product and a much smaller blast radius.
 *
 * ## Who may ask
 *
 * On the default network, anybody — it is play money and gating it would only
 * stop people trying the demo. On a real network this is a door onto somebody's
 * actual USDC, so `lib/deposit-gate.ts` answers first, with the same allowlist
 * and the same signature that `lib/settle-gate.ts` puts in front of the escrow.
 * It runs *before* the operator-address check below, so a stranger is refused
 * without learning whether there is anything deployed to reach.
 *
 * Statelessness has one consequence worth naming. This route will confirm the
 * same deposit as many times as it is asked, so it proves the money arrived
 * and *not* that it has not already been spent. Issuing a card against a memo
 * is the step that must happen once, and that is where the once-only claim
 * lives — not here.
 */
import { arsToUsdCents, getArsPerUsd } from '@changuito/mcp/fx';

import { canIssueCard, rememberDepositor } from '../../../lib/card.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../lib/deployments.ts';
import { depositAddress, depositAsset, isMemo, mintMemo, type DepositAsset } from '../../../lib/deposit.ts';
import { authorizeRealMode, realModeNeedsProof } from '../../../lib/deposit-gate.ts';
import { findDeposit } from '../../../lib/deposit-watch.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { proofFromBody } from '../../../lib/wallet-proof-verify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface DepositIntent {
  network: NetworkId;
  address: string;
  asset: DepositAsset;
  memo: string;
  /** The figure to send, as a 7-decimal string — what a wallet wants pasted in. */
  amount: string;
  /** The basket, for the line the shopper reads. */
  centavos: number;
  usdCents: number;
  arsPerUsd: number;
  source: string;
  /**
   * Whether this deployment can mint a single-use card at all. Answered here
   * rather than in a `NEXT_PUBLIC_` flag so the browser learns it from the
   * same server that would have to honour it — and so a deployment without a
   * card provider never renders a button that 503s.
   */
  cardAvailable: boolean;
}

export interface DepositStatus {
  status: 'waiting' | 'confirmed';
  txHash?: string;
  /** What actually arrived, which is not always what was quoted. */
  amount?: string;
  at?: string;
}

/**
 * The buffer is 15%, the same one the card-funding path in @changuito/mcp
 * uses and for the same reason: the card network applies its own rate when the
 * supermarket charges it, and a cent short at the till is a decline in front
 * of a shopper with a full basket. The escrow path quotes at zero buffer
 * because it settles the exact number it locked; this one does not.
 */
const BUFFER = 0.15;

function networkFrom(value: string | null): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

/**
 * The deposit figure, in whichever asset this network takes.
 *
 * On mainnet the asset is USDC and this is a conversion: one USDC is one US
 * dollar, so US cents divided by a hundred is the amount.
 *
 * On testnet the asset is XLM — mock USDC is a Soroban token with no classic
 * payment record to carry a memo — and **this is deliberately not an XLM
 * price.** There is no XLM/ARS feed in this app and inventing one to move play
 * money would be a lie with a decimal point in it. The rehearsal sends the
 * same figure denominated in free testnet XLM, so every digit downstream is
 * exercised, and the copy says "de prueba" next to it.
 */
export function depositAmount(usdCents: number): string {
  return (usdCents / 100).toFixed(7);
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const input = (body ?? {}) as { centavos?: unknown; network?: unknown; address?: unknown };

  const centavos = Number(input.centavos);
  if (!Number.isInteger(centavos) || centavos <= 0) {
    return Response.json({ error: 'centavos must be a positive integer' }, { status: 400 });
  }

  const network = networkFrom(typeof input.network === 'string' ? input.network : null);

  // Before anything that costs, and before the operator address is even looked
  // up. A wallet that may not use this network is told so and nothing else.
  const auth = authorizeRealMode({
    address: typeof input.address === 'string' ? input.address : '',
    proof: proofFromBody(body),
    now: Date.now(),
    net: network,
  });
  if (!auth.ok) {
    return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });
  }

  const address = depositAddress(network);
  if (!address) {
    // Not configured is not the shopper's problem to decode, but it is
    // absolutely the operator's, so the log says which variable is missing.
    console.error(`[deposit] no DEPOSIT_ADDRESS_${network.toUpperCase()} set`);
    return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });
  }

  try {
    const override = Number(process.env.FX_ARS_PER_USD);
    const rate = await getArsPerUsd(Number.isFinite(override) && override > 0 ? { override } : {});
    const usdCents = arsToUsdCents(centavos, rate.arsPerUsd, BUFFER);

    const memo = mintMemo();

    // Only where the signature above actually proved the address. In mode
    // 'open' nothing was proven, so writing the claimed address down would be
    // recording a guess and then trusting it later — and `POST /api/card`
    // skips the check in that mode for the same reason.
    if (realModeNeedsProof(auth.mode)) {
      // A failure here is not the shopper's problem *yet* — it becomes one when
      // they try to mint a card, which will refuse rather than let an unowned
      // memo through. Loud, because that is a manual refund.
      await rememberDepositor(network, memo, (input.address as string).trim().toUpperCase()).catch((err) => {
        console.error('[deposit] could not record the depositor:', err instanceof Error ? err.message : String(err));
      });
    }

    const intent: DepositIntent = {
      network,
      address,
      asset: depositAsset(network),
      memo,
      amount: depositAmount(usdCents),
      centavos,
      usdCents,
      arsPerUsd: rate.arsPerUsd,
      source: rate.source,
      cardAvailable: canIssueCard(),
    };
    return Response.json(intent);
  } catch (err) {
    // assertSaneRate throws rather than returning a bad number. Refusing to
    // quote is correct: the alternative is pricing a basket off a feed that
    // said one peso to the dollar.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `no pudimos cotizar el carrito: ${message}` }, { status: 502 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const q = new URL(req.url).searchParams;
  const memo = q.get('memo') ?? '';
  const amount = q.get('amount') ?? '';
  const network = networkFrom(q.get('network'));

  if (!isMemo(memo)) return Response.json({ error: 'memo inválido' }, { status: 400 });
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) return Response.json({ error: 'monto inválido' }, { status: 400 });

  const address = depositAddress(network);
  if (!address) return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });

  try {
    const hit = await findDeposit(network, {
      to: address,
      asset: depositAsset(network),
      memo,
      minAmount: amount,
    });
    const body: DepositStatus = hit
      ? { status: 'confirmed', txHash: hit.txHash, amount: hit.amount, at: hit.at }
      : { status: 'waiting' };
    return Response.json(body);
  } catch (err) {
    // Horizon being unreachable is not "no deposit" — saying so would tell a
    // shopper who has already paid that they have not.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deposit] horizon read failed:', message);
    return Response.json({ error: 'no pudimos consultar la red en este momento' }, { status: 502 });
  }
}
