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
 */
import { networkOrDefault, type NetworkId } from '../../../lib/deployments.ts';
import { accountBalances, addressKind, formatUsdc, MIN_XLM } from '../../../lib/stellar.ts';
import { usdcBalance } from '../../../lib/token.ts';
import { trustlineState, type TrustlineState } from '../../../lib/trustline.ts';
import { requireHuman } from '../../../lib/human-gate.ts';

// XDR encoding is Node, not edge.
export const runtime = 'nodejs';
// Balances change; a cached one is worse than a slow one.
export const dynamic = 'force-dynamic';

export interface BalanceResponse {
  address: string;
  /** Decimal XLM, or null for a smart wallet (a contract holds no Horizon account). */
  xlm: string | null;
  /** Demo USDC in token units, as a string because it is an i128. */
  usdc: string;
  /** The same number, rounded for a person: "12.34". */
  usdcDisplay: string;
  /** True once the address exists on-ledger and can pay a fee. */
  funded: boolean;
  /**
   * Whether this account has opted into the network's USDC. Always
   * `not-needed` in modo prueba, where the token has no issuer — which is why
   * this field can be read unconditionally instead of behind a mode check.
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

  try {
    // Independent reads, so they go together. A token balance for an address
    // that has never held any is 0, not an error — that is the normal case for
    // a wallet that just logged in.
    //
    // The whole Horizon account rather than just its XLM: the fee balance and
    // the trustline are two facts in one response, and asking twice would be
    // two round trips for one read.
    const [balances, usdc] = await Promise.all([
      kind === 'account' ? accountBalances(address, network) : Promise.resolve(null),
      usdcBalance(address, network),
    ]);
    const xlm = balances === null ? null : (balances.find((b) => b.asset_type === 'native')?.balance ?? '0');

    const body: BalanceResponse = {
      address,
      xlm,
      usdc: usdc.toString(),
      usdcDisplay: formatUsdc(usdc),
      // "Funded" has to mean "can pay a fee", not "the account row exists" —
      // a Pollar wallet is created sponsored at 0 XLM, so existence alone left
      // this true while the widget showed 0.00 and the warning stayed hidden.
      // A contract wallet pays fees some other way, so it is never unfunded.
      funded: kind === 'contract' || (xlm !== null && Number(xlm) >= MIN_XLM),
      // A smart wallet holds a SAC asset in contract storage, so there is no
      // trustline to open and `balances` is null for a reason that is not
      // "has opted into nothing".
      trustline: kind === 'contract' ? 'not-needed' : trustlineState(balances, network),
      network,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `could not read balances: ${message}` }, { status: 502 });
  }
}
