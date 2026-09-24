import { authorizeFaucet } from './faucet-auth.ts';
import type { FaucetProof } from './faucet-proof.ts';
import { requireHuman } from './human-gate.ts';
import { guestTurnCounter, limiterUnavailableResponse, takeQuota, type TurnCounter } from './login-gate.ts';
import { addressKind } from './stellar.ts';

/**
 * Everything POST /api/faucet decides before it touches the chain.
 *
 * Its own module so the refusals can be tested as a route: the handler
 * itself imports the contract bindings, which ship as TypeScript inside
 * node_modules and cannot load under `--experimental-strip-types`.
 *
 * Returns the address to fund, or the Response to send instead. Nothing
 * here signs, funds or mints.
 *
 * The cooldown used to be a Map per lambda, which a cold start or a second
 * instance forgot. It now lives in the shared counter, with a global hourly
 * ceiling on top, and both refuse when the store cannot answer.
 */

/** One grant per wallet per minute. */
export const FAUCET_COOLDOWN_SECONDS = 60;

/** Every tester together, per hour. The hot key signs each one. */
export const FAUCET_GRANTS_PER_HOUR = 20;
export async function gateFaucet(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  store: TurnCounter = guestTurnCounter(env),
): Promise<{ address: string; kind: 'account' | 'contract' } | Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  let address: string;
  let proof: Partial<FaucetProof> | null = null;
  try {
    const body = (await req.json()) as { address?: unknown; proof?: unknown };
    address = typeof body.address === 'string' ? body.address : '';
    if (body.proof && typeof body.proof === 'object') proof = body.proof as Partial<FaucetProof>;
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const kind = addressKind(address);
  if (!kind) return Response.json({ error: 'not a Stellar address' }, { status: 400 });

  const auth = authorizeFaucet({ address, proof, now, env });
  if (!auth.ok) return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });

  const wait = 'Esperá un momento antes de volver a pedir fondos.';
  const mine = await takeQuota(`changuito:faucet:${address}`, 1, FAUCET_COOLDOWN_SECONDS, store);
  if (mine === 'unavailable') return limiterUnavailableResponse();
  // `note` because the widget reads a 429 as an answer, not a failure.
  if (mine === 'limited') return Response.json({ error: 'rate_limited', message: wait, note: wait }, { status: 429 });
  const all = await takeQuota('changuito:faucet:global', FAUCET_GRANTS_PER_HOUR, 3600, store);
  if (all === 'unavailable') return limiterUnavailableResponse();
  if (all === 'limited') {
    const busy = 'Se alcanzó el tope de cargas de prueba por ahora. Probá más tarde.';
    return Response.json({ error: 'rate_limited', message: busy, note: busy }, { status: 429 });
  }

  return { address, kind };
}
