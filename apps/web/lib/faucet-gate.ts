import type { NetworkId } from './deployments.ts';
import { authorizeFaucet } from './faucet-auth.ts';
import type { FaucetProof } from './faucet-proof.ts';
import { requireHuman } from './human-gate.ts';
import { guestTurnCounter, limiterUnavailableResponse, takeQuota, type TurnCounter } from './login-gate.ts';
import { requestNetwork } from './server-network.ts';
import { addressKind } from './stellar.ts';
import { verifyWalletProof } from './wallet-proof-verify.ts';
import { faucetOpenToAll, walletOpensFaucet, walletStanding, type WalletDirectory } from './wallet-record.ts';

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
  wallets?: WalletDirectory,
): Promise<{ address: string; kind: 'account' | 'contract'; network: NetworkId } | Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  let address: string;
  let proof: Partial<FaucetProof> | null = null;
  let networkParam: unknown = undefined;
  try {
    const body = (await req.json()) as { address?: unknown; proof?: unknown; network?: unknown };
    address = typeof body.address === 'string' ? body.address : '';
    if (body.proof && typeof body.proof === 'object') proof = body.proof as Partial<FaucetProof>;
    networkParam = body.network;
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  // Absent means the default; present-but-unserved is refused, never coerced.
  const asked = requestNetwork(networkParam);
  if (!asked.ok) return Response.json({ error: 'network_not_served' }, { status: 400 });
  const network = asked.network;

  const kind = addressKind(address);
  if (!kind) return Response.json({ error: 'not a Stellar address' }, { status: 400 });

  // Read only. Login is what inserts a row, after a proof. A bare address
  // posted here must not become a wallet.
  const standing = await walletStanding(address, env, network, wallets);
  if (standing.banned) {
    return Response.json({ error: 'wallet_banned', message: 'Esta cuenta no puede usar Changuito.' }, { status: 403 });
  }

  const auth = authorizeFaucet({ address, proof, now, env, net: network });
  if (!auth.ok) {
    const open = walletOpensFaucet(standing, await faucetOpenToAll(env, wallets), auth.error);
    if (!open) return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });
    const signed = verifyWalletProof({ intent: 'faucet', address, proof, now });
    if (!signed.ok) {
      const error = signed.error === 'proof_missing' ? 'faucet_session_required' : signed.error === 'proof_expired' ? 'faucet_proof_expired' : 'faucet_proof_invalid';
      const message =
        signed.error === 'proof_missing'
          ? 'Iniciá sesión con la cuenta de prueba para cargar USDC.'
          : signed.error === 'proof_expired'
            ? 'La confirmación venció. Probá de nuevo.'
            : 'No pudimos confirmar tu sesión. Probá de nuevo.';
      return Response.json({ error, message }, { status: 401 });
    }
  }

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

  return { address, kind, network };
}
