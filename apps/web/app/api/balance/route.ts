/**
 * GET /api/balance?address=G…  ->  { xlm, usdc, usdcDisplay }
 *
 * The browser's only window onto the chain. Keeping it server-side keeps
 * @stellar/stellar-sdk out of the client bundle, and keeps the RPC endpoint one
 * place rather than one per component.
 */
import { addressKind, formatUsdc, MIN_XLM, nativeBalance } from '../../../lib/stellar.ts';
import { usdcBalance } from '../../../lib/token.ts';
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
}

export async function GET(req: Request): Promise<Response> {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  const kind = addressKind(address);
  if (!kind) {
    return Response.json({ error: 'not a Stellar address' }, { status: 400 });
  }

  try {
    // Independent reads, so they go together. A token balance for an address
    // that has never held any is 0, not an error — that is the normal case for
    // a wallet that just logged in.
    const [xlm, usdc] = await Promise.all([
      kind === 'account' ? nativeBalance(address) : Promise.resolve(null),
      usdcBalance(address),
    ]);

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
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `could not read balances: ${message}` }, { status: 502 });
  }
}
