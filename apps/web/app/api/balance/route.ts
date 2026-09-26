/**
 * GET /api/balance?address=G…&network=…  ->  { xlm, usdc, usdcDisplay }
 *
 * The browser's only window onto the chain. Keeping it server-side keeps
 * @stellar/stellar-sdk out of the client bundle, and keeps the RPC endpoint one
 * place rather than one per component.
 *
 * `network` is a parameter rather than a cookie on purpose: ambient state means
 * a tab left open in one mode reads the other one's numbers. Unknown values
 * fall back to the default, which is the read that cannot mislead — and a read
 * needs no allowlist, since looking at a public ledger spends nothing.
 *
 * ## One read, not two
 *
 * This used to ask Horizon for the account and a Soroban contract for the USDC,
 * in parallel, and combine them. That was wrong on the only network anybody is
 * signed in to. Mainnet USDC is a *classic* Circle asset — `contracts.usdc.id`
 * is `""` there — so the token call was built with an empty contract id and an
 * empty source account and could never succeed. Every signed-in balance read
 * 502'd, and the shopper read the failure in English beside their balance.
 *
 * The number was already in the first answer. A classic balance lives on the
 * trustline, and `accountBalances` returns every line the account holds, so
 * `classicBalance` picks USDC out of what is in hand. The token call survives
 * for the two cases that genuinely need it: a holder that is a contract, whose
 * balance lives in contract storage and not on any Horizon account, and a
 * network whose USDC has no issuer at all.
 *
 * ## There is no `funded` field, and its absence is the decision
 *
 * There was one. It meant "holds at least MIN_XLM, so it can pay a fee", and
 * two screens turned that into *falta saldo para comisiones*.
 *
 * Pollar sponsors the fee. A custodial session's `signTx` comes back as a
 * fee-bumped envelope the app pays for, `setTrustline` sponsors the 0.5 XLM
 * reserve as well, and a smart wallet has no Horizon account to hold XLM in
 * at all. Nothing in this repo passes `skipSponsorship`, and `WalletProvider`
 * configures no wallet adapters, so there is no session here that spends the
 * shopper's own XLM.
 *
 * Which made the warning worse than useless: a Pollar wallet is created
 * sponsored at 0 XLM and stays there, so it fired for every signed-in shopper,
 * about a problem they did not have and could not have fixed.
 *
 * `xlm` stays. It is free — the same Horizon read — and it is the number to
 * look at when a signature fails. What is gone is the app deciding, from that
 * number, that something is wrong.
 *
 * This rests on something outside this repo: sponsorship is a switch in the
 * Pollar dashboard. Turn it off and signing starts failing with
 * `tx_insufficient_fee`; the honest answer then is to bring the field back,
 * not to widen the error copy.
 */
import { networkOrDefault, type NetworkId } from '../../../lib/deployments.ts';
import { accountBalances, addressKind, classicBalance, formatUsdc } from '../../../lib/stellar.ts';
import { usdcBalance } from '../../../lib/token.ts';
import { trustlineFor, usdcAsset, type TrustlineState } from '../../../lib/trustline.ts';
import { requireHuman } from '../../../lib/human-gate.ts';

// XDR encoding is Node, not edge.
export const runtime = 'nodejs';
// Balances change; a cached one is worse than a slow one.
export const dynamic = 'force-dynamic';

export interface BalanceResponse {
  address: string;
  /** Decimal XLM, or null for a smart wallet (a contract holds no Horizon account). */
  xlm: string | null;
  /** USDC in token units, as a string because it is an i128. */
  usdc: string;
  /** The same number, rounded for a person: "12.34". */
  usdcDisplay: string;
  /**
   * Whether this account has opted into the network's USDC. Both networks now
   * have a classic issuer, so both can answer `needed` — the asymmetry this
   * field was written for ended with scripts/setup-demo-asset.mjs. It stays
   * readable unconditionally because a contract holder is `not-needed`.
   */
  trustline: TrustlineState;
  /** Echoed so a caller can tell which chain answered. */
  network: NetworkId;
}

export async function GET(req: Request): Promise<Response> {
  // The middleware checks this too; a handler that trusts only the matcher
  // is open the day the matcher changes.
  const gated = await requireHuman(req);
  if (gated) return gated;

  const params = new URL(req.url).searchParams;
  const address = params.get('address') ?? '';
  const network = networkOrDefault(params.get('network'));
  const kind = addressKind(address);
  if (!kind) {
    return Response.json({ error: 'not a Stellar address' }, { status: 400 });
  }

  const asset = usdcAsset(network);

  try {
    // The whole Horizon account rather than just its XLM: the trustline and
    // the USDC on it come out of the same answer, and asking separately would
    // be three round trips for one read.
    const balances = kind === 'account' ? await accountBalances(address, network) : null;
    const xlm = balances === null ? null : (balances.find((b) => b.asset_type === 'native')?.balance ?? '0');

    // A G-address holding a classic asset: the number is on the line Horizon
    // just returned, and zero for an account with no such line is the honest
    // answer rather than a failure — that is the normal state of a wallet that
    // has only just signed in.
    //
    // Anything else has to ask the token. A contract holder keeps its balance
    // in contract storage, and a network whose USDC has no issuer has no
    // trustline to read. Both throw where no token is deployed, which is
    // caught below and is the truth: on that combination we cannot know.
    const usdc =
      kind === 'account' && asset
        ? classicBalance(balances, asset.code, asset.issuer)
        : await usdcBalance(address, network);

    const body: BalanceResponse = {
      address,
      xlm,
      usdc: usdc.toString(),
      usdcDisplay: formatUsdc(usdc),
      // A smart wallet holds a SAC asset in contract storage, so there is no
      // trustline to open and `balances` is null for a reason that is not
      // "has opted into nothing".
      trustline: kind === 'contract' ? 'not-needed' : trustlineFor(balances, asset),
      network,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `could not read balances: ${message}` }, { status: 502 });
  }
}
