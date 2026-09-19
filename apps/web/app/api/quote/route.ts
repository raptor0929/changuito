/**
 * GET /api/quote?centavos=1234500  ->  what that basket costs in demo USDC.
 *
 * Server-side for two reasons: the FX source has no CORS headers, and its
 * module-level cache is only worth having if one process answers everyone
 * rather than every tab fetching its own rate.
 */
import { arsToUsdCents, getArsPerUsd } from '@changuito/mcp/fx';

import { centsToUnits, formatUsdc } from '../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface QuoteResponse {
  centavos: number;
  arsPerUsd: number;
  source: string;
  /** Integer US cents, rounded up. */
  usdCents: number;
  /** The same amount in token units (7 decimals), as a string — it is an i128. */
  units: string;
  /** "12.34", for the line the user reads before signing. */
  display: string;
}

export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get('centavos') ?? '';
  const centavos = Number(raw);
  if (!Number.isInteger(centavos) || centavos <= 0) {
    return Response.json({ error: 'centavos must be a positive integer' }, { status: 400 });
  }

  try {
    // A pinned rate makes a demo reproducible; without it we use the live one.
    const override = Number(process.env.FX_ARS_PER_USD);
    const rate = await getArsPerUsd(Number.isFinite(override) && override > 0 ? { override } : {});

    // Zero buffer, unlike the MCP's card-funding path. That buffer exists
    // because a card network applies its own rate at settlement and a cent
    // short is a decline at the till. Here the escrow locks exactly the
    // number the user approved and settles that same number to the treasury,
    // so a 15% cushion would just be a 15% overcharge.
    const usdCents = arsToUsdCents(centavos, rate.arsPerUsd, 0);
    const units = centsToUnits(usdCents);

    const body: QuoteResponse = {
      centavos,
      arsPerUsd: rate.arsPerUsd,
      source: rate.source,
      usdCents,
      units: units.toString(),
      display: formatUsdc(units),
    };
    return Response.json(body);
  } catch (err) {
    // A bad rate throws rather than returning a number — see assertSaneRate.
    // Refusing to quote is the correct outcome: the alternative is pricing a
    // basket off a feed that returned 1 ARS per dollar.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `no pudimos cotizar el carrito: ${message}` }, { status: 502 });
  }
}
