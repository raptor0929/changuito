/**
 * POST /api/faucet { address, proof }  ->  { xlm, usdc, usdcDisplay, txHash, created }
 *
 * Two steps, in this order, and the order is the point:
 *
 *   1. friendbot, if the address has no account yet. An address nobody funded
 *      is just a public key — every transaction it signs fails with
 *      tx_no_source_account, which reads like a bug in the app rather than an
 *      empty wallet.
 *   2. mint demo USDC.
 *
 * Doing it the other way round hands someone money they cannot spend.
 *
 * Both steps sign with our keys, so neither runs until `authorizeFaucet` says
 * so: in production only allowlisted testers, proving the wallet with a fresh
 * SEP-53 signature. See lib/faucet-auth.ts.
 *
 * GET /api/faucet?address=…  ->  { mode, allowed }, so the widget can leave
 * the button out instead of showing one that can only fail.
 */
import { faucetAccess } from '../../../lib/faucet-auth.ts';
import { gateFaucet } from '../../../lib/faucet-gate.ts';
import { faucetVerdict } from '../../../lib/faucet-policy.ts';
import type { FaucetAccess } from '../../../lib/faucet-proof.ts';
import { usdcAsAdmin } from '../../../lib/server/resolver.ts';
import { addressKind, ensureFunded, formatUsdc } from '../../../lib/stellar.ts';
import { usdcBalance } from '../../../lib/token.ts';
import { requireHuman } from '../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface FaucetResponse {
  address: string;
  /** XLM after funding, or null for a smart wallet. */
  xlm: string | null;
  /** True when friendbot created the account on this call. */
  created: boolean;
  usdc: string;
  usdcDisplay: string;
  /** The mint transaction, or null when the wallet already had enough. */
  txHash: string | null;
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const address = new URL(req.url).searchParams.get('address') ?? '';
  const access: FaucetAccess = addressKind(address)
    ? faucetAccess(address)
    : { mode: faucetAccess('').mode, allowed: false };
  return Response.json(access, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  // Before friendbot and before the mint: both are signed by us.
  const gate = await gateFaucet(req);
  if (gate instanceof Response) return gate;
  const { address, kind } = gate;

  try {
    // 1. XLM first. A contract wallet has no Horizon account to fund.
    let xlm: string | null = null;
    let created = false;
    if (kind === 'account') {
      const funding = await ensureFunded(address);
      xlm = funding.xlm;
      created = funding.created;
    }

    // 2. Then the token, if they need it.
    const before = await usdcBalance(address);
    const verdict = faucetVerdict({
      balanceUnits: before,
      now: Date.now(),
    });

    if (!verdict.allow) {
      // Not an error when we just created the account: they got their XLM, and
      // "you already have enough USDC" is a perfectly good outcome.
      const body: FaucetResponse & { note: string } = {
        address,
        xlm,
        created,
        usdc: before.toString(),
        usdcDisplay: formatUsdc(before),
        txHash: null,
        note: verdict.reason,
      };
      return Response.json(body, { status: created ? 200 : 429 });
    }

    const tx = await usdcAsAdmin().mint({ to: address, amount: verdict.amount });
    const sent = await tx.signAndSend();

    const after = before + verdict.amount;
    const body: FaucetResponse = {
      address,
      xlm,
      created,
      usdc: after.toString(),
      usdcDisplay: formatUsdc(after),
      txHash: sent.sendTransactionResponse?.hash ?? null,
    };
    return Response.json(body);
  } catch (err) {
    // Friendbot and Soroban errors carry URLs and XDR; the log keeps them.
    console.error('[faucet] failed:', err);
    return Response.json({ error: 'No pudimos cargar USDC de prueba. Probá de nuevo en un momento.' }, { status: 502 });
  }
}
