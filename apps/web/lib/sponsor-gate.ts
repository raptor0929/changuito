/**
 * Everything POST /api/sponsor decides before it locks XLM.
 *
 * Same house pattern as `lib/faucet-gate.ts`: Turnstile, the faucet allowlist
 * (or open-to-all), a SEP-53 proof, and a shared rate limit. Each successful
 * prepare that still needs work locks ~1.5 XLM on the sponsor, so an open
 * endpoint is not acceptable.
 */
import type { NetworkId } from './deployments.ts';
import { authorizeFaucet } from './faucet-auth.ts';
import type { FaucetProof } from './faucet-proof.ts';
import { requireHuman } from './human-gate.ts';
import { guestTurnCounter, limiterUnavailableResponse, takeQuota, type TurnCounter } from './login-gate.ts';
import { requestNetwork } from './server-network.ts';
import { addressKind } from './stellar.ts';
import { faucetAdmitted, faucetOpenToAll, walletStanding, type WalletDirectory } from './wallet-record.ts';

/** One sponsorship attempt per wallet per minute. */
export const SPONSOR_COOLDOWN_SECONDS = 60;

/** Every caller together, per hour — each grant locks sponsor reserve. */
export const SPONSOR_GRANTS_PER_HOUR = 40;

export type SponsorGateOk = {
  address: string;
  network: NetworkId;
  step: 'prepare' | 'submit';
  signedXdr: string | null;
};

export async function gateSponsor(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  store: TurnCounter = guestTurnCounter(env),
  wallets?: WalletDirectory,
): Promise<SponsorGateOk | Response> {
  const gated = await requireHuman(req, env);
  if (gated) return gated;

  let address: string;
  let proof: Partial<FaucetProof> | null = null;
  let networkParam: unknown = undefined;
  let step: 'prepare' | 'submit';
  let signedXdr: string | null = null;
  try {
    const body = (await req.json()) as {
      address?: unknown;
      proof?: unknown;
      network?: unknown;
      step?: unknown;
      signedXdr?: unknown;
    };
    address = typeof body.address === 'string' ? body.address : '';
    if (body.proof && typeof body.proof === 'object') proof = body.proof as Partial<FaucetProof>;
    networkParam = body.network;
    if (body.step !== 'prepare' && body.step !== 'submit') {
      return Response.json({ error: 'bad request' }, { status: 400 });
    }
    step = body.step;
    if (step === 'submit') {
      if (typeof body.signedXdr !== 'string' || !body.signedXdr) {
        return Response.json({ error: 'signedXdr required' }, { status: 400 });
      }
      signedXdr = body.signedXdr;
    }
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const asked = requestNetwork(networkParam);
  if (!asked.ok) return Response.json({ error: 'network_not_served' }, { status: 400 });
  const network = asked.network;

  const kind = addressKind(address);
  if (!kind) return Response.json({ error: 'not a Stellar address' }, { status: 400 });
  // Classic sponsorship is for G-accounts. A contract wallet has no Horizon
  // account to create and no changeTrust source.
  if (kind !== 'account') {
    return Response.json(
      { error: 'sponsor_account_only', message: 'El sponsorship es solo para cuentas clásicas.' },
      { status: 400 },
    );
  }

  const standing = await walletStanding(address, env, network, wallets);
  if (standing.banned) {
    return Response.json({ error: 'wallet_banned', message: 'Esta cuenta no puede usar Changuito.' }, { status: 403 });
  }

  const openToAll = await faucetOpenToAll(env, wallets);
  const auth = authorizeFaucet({
    address,
    proof,
    now,
    net: network,
    admitted: faucetAdmitted(standing, openToAll),
  });
  if (!auth.ok) return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });

  // Quota only on prepare. Submit is the same grant finishing; a 60s cooldown
  // between prepare and submit would strand a signed envelope.
  if (step === 'prepare') {
    const wait = 'Esperá un momento antes de volver a pedir sponsorship.';
    const mine = await takeQuota(`changuito:sponsor:${address}`, 1, SPONSOR_COOLDOWN_SECONDS, store);
    if (mine === 'unavailable') return limiterUnavailableResponse();
    if (mine === 'limited') return Response.json({ error: 'rate_limited', message: wait, note: wait }, { status: 429 });

    const all = await takeQuota('changuito:sponsor:global', SPONSOR_GRANTS_PER_HOUR, 3600, store);
    if (all === 'unavailable') return limiterUnavailableResponse();
    if (all === 'limited') {
      const busy = 'Se alcanzó el tope de sponsorships por ahora. Probá más tarde.';
      return Response.json({ error: 'rate_limited', message: busy, note: busy }, { status: 429 });
    }
  }

  return { address, network, step, signedXdr };
}
