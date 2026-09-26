/**
 * POST /api/deposit/demo { memo, amount, network } -> { txHash }
 *
 * The one thing preview does that production does not: we pay.
 *
 * A visitor with no session has no wallet, and the whole point of preview is
 * that they do not need one — they search, fill a basket, and watch a payment
 * settle and a card appear without connecting anything. Something has to sign
 * that payment, so this route does, out of the demo wallet.
 *
 * Everything around it is the code production runs. `POST /api/deposit` mints
 * the memo and quotes the amount with no change at all — `authorizeRealMode`
 * already answers `{ ok, mode: 'open' }` for an unsigned testnet request — and
 * `GET /api/deposit` reads the payment back off Horizon exactly as it would
 * read a shopper's own. This route slots between them and nothing else moves.
 *
 * ## Why this is not a faucet
 *
 * A faucet hands money to an address the caller names. This hands money to an
 * address *we* name, in an asset that only exists on a test ledger, for a memo
 * that was minted here moments ago. There is no destination parameter, so the
 * worst a caller can do with it is make the demo wallet pay the deposit
 * account — which is what the button does.
 *
 * ## What is checked, and in what order
 *
 * 1. `requireHuman`, as every route does, and first.
 * 2. The network must have a demo wallet. Only testnet does, and mainnet's is
 *    `''` in deployments.json, so a future third network cannot quietly
 *    inherit a spender by being added to the enum.
 * 3. The memo must be one of ours — `isMemo`, the same check the poll does.
 * 4. The amount must parse as a Stellar amount and sit under the card ceiling.
 *    Reusing `CARD_MAX_CENTS` rather than inventing a number: the deposit
 *    exists to fund a card, so an amount no card could hold is not a deposit.
 * 5. A quota, in the shape `lib/faucet-gate.ts` established. That gate is the
 *    house pattern for "we are about to spend something on your behalf", and
 *    two gates answering the same question in two shapes is how one ends up
 *    wrong.
 *
 * None of it is a guard against loss — the money is worthless. It is a guard
 * against the demo wallet being drained of *reserve* by someone holding the
 * button down, which would take preview down for everybody else.
 */
import { CARD_MAX_CENTS } from '@changuito/mcp/pay';
import { Asset, BASE_FEE, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import { asNetwork, DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from '../../../../lib/deployments.ts';
import { depositAddress, depositAsset, isMemo } from '../../../../lib/deposit.ts';
import { stroops } from '../../../../lib/deposit-watch.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';
import {
  clientIp,
  guestTurnCounter,
  limiterUnavailableResponse,
  takeQuota,
  type TurnCounter,
} from '../../../../lib/login-gate.ts';
import { canDemoPay, demoWalletAddress, demoWalletKeypair } from '../../../../lib/server/demo-wallet.ts';
import { horizon } from '../../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One demo payment per visitor per 30s. A basket takes longer than that. */
export const DEMO_PAY_COOLDOWN_SECONDS = 30;
/** Everybody together, per hour. The demo wallet pays a fee for each one. */
export const DEMO_PAYS_PER_HOUR = 200;

/** The card cannot hold more, so a deposit that large is not for a card. */
const MAX_STROOPS = BigInt(CARD_MAX_CENTS) * 100_000n;

/**
 * Two accounts sharing one sequence number is the failure a public demo will
 * find within the hour: two visitors press the button at the same moment, both
 * build against the same sequence, and the second submit comes back
 * `tx_bad_seq`. Reloading and rebuilding is the fix — the transaction is
 * idempotent in the only sense that matters, since the memo ties it to one
 * order and `matchDeposit` takes the first payment that satisfies it.
 */
const SUBMIT_ATTEMPTS = 3;

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const input = (body ?? {}) as { memo?: unknown; amount?: unknown; network?: unknown };

  // Absent means the default; present-but-unknown is named rather than
  // quietly coerced, the same way gateFaucet reads it.
  const network: NetworkId | null =
    input.network === undefined ? DEFAULT_NETWORK : asNetwork(input.network);
  if (network === null) return Response.json({ error: 'network no reconocida' }, { status: 400 });

  if (!demoWalletAddress(network)) {
    // Deliberately not 404. The route exists; this network has nobody to pay
    // with, and saying so is more useful than pretending it is not here.
    return Response.json({ error: 'demo_not_available' }, { status: 403 });
  }

  const memo = input.memo;
  if (!isMemo(memo)) return Response.json({ error: 'memo inválido' }, { status: 400 });

  const amount = typeof input.amount === 'string' ? input.amount.trim() : '';
  const want = stroops(amount);
  if (want === null || want <= 0n) return Response.json({ error: 'monto inválido' }, { status: 400 });
  if (want > MAX_STROOPS) return Response.json({ error: 'monto demasiado grande' }, { status: 400 });

  const to = depositAddress(network);
  if (!to) {
    console.error(`[deposit/demo] no DEPOSIT_ADDRESS_${network.toUpperCase()} set`);
    return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });
  }
  if (!canDemoPay(network)) {
    console.error('[deposit/demo] DEMO_WALLET_SECRET is not set — preview cannot pay');
    return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });
  }

  const quota = await gateQuota(req);
  if (quota) return quota;

  try {
    const txHash = await payFromDemoWallet(network, { to, amount, memo });
    return Response.json({ txHash });
  } catch (err) {
    // The message can carry the transaction, and the transaction was built
    // with our key — so the log gets it and the shopper gets a sentence.
    console.error('[deposit/demo] payment failed:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'no pudimos hacer el pago de prueba en este momento' }, { status: 502 });
  }
}

async function gateQuota(req: Request, store: TurnCounter = guestTurnCounter()): Promise<Response | null> {
  // The human cookie is the better key — it is per browser rather than per
  // office — but it is not readable here, so the IP is what there is. Falling
  // back to a shared bucket when there is no IP is deliberate: an unbucketed
  // caller would otherwise be the only one with no limit.
  const who = clientIp(req) ?? 'unknown';
  const wait = 'Esperá unos segundos antes de volver a probar.';

  const mine = await takeQuota(`changuito:demo-pay:${who}`, 1, DEMO_PAY_COOLDOWN_SECONDS, store);
  if (mine === 'unavailable') return limiterUnavailableResponse();
  if (mine === 'limited') return Response.json({ error: 'rate_limited', message: wait }, { status: 429 });

  const all = await takeQuota('changuito:demo-pay:global', DEMO_PAYS_PER_HOUR, 3600, store);
  if (all === 'unavailable') return limiterUnavailableResponse();
  if (all === 'limited') {
    const busy = 'Se alcanzó el tope de pagos de prueba por ahora. Probá más tarde.';
    return Response.json({ error: 'rate_limited', message: busy }, { status: 429 });
  }
  return null;
}

async function payFromDemoWallet(
  net: NetworkId,
  want: { to: string; amount: string; memo: string },
): Promise<string> {
  const kp = demoWalletKeypair(net);
  const server = horizon(net);
  const asset = depositAsset(net);
  const payment = Operation.payment({
    destination: want.to,
    asset: asset.issuer ? new Asset(asset.code, asset.issuer) : Asset.native(),
    amount: want.amount,
  });

  let last: unknown;
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
    // Reloaded every attempt, which is the whole point of retrying.
    const source = await server.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: DEPLOYMENTS[net].networkPassphrase,
    })
      .addOperation(payment)
      .addMemo(Memo.text(want.memo))
      .setTimeout(30)
      .build();
    tx.sign(kp);

    try {
      const res = await server.submitTransaction(tx);
      return res.hash;
    } catch (err) {
      last = err;
      if (!isBadSequence(err)) throw err;
    }
  }
  throw last instanceof Error ? last : new Error('could not submit the demo payment');
}

/** Horizon buries the reason; anything else is not worth retrying. */
function isBadSequence(err: unknown): boolean {
  const codes = (err as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } })
    ?.response?.data?.extras?.result_codes;
  return codes?.transaction === 'tx_bad_seq';
}
