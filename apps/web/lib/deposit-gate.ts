import { DEFAULT_NETWORK, type NetworkId } from './deployments.ts';
import { networkAccess, type RealModeMode } from './network-access.ts';
import type { WalletProof } from './wallet-proof.ts';
import { verifyWalletProof } from './wallet-proof-verify.ts';

/**
 * Who may spend real money on the deposit rail. Server-only.
 *
 * `lib/settle-gate.ts` put the escrow behind `REAL_MODE_ALLOWLIST_ADDRESSES`
 * and the deposit rail arrived without the same door. Nothing was holding it
 * shut except `DEPOSIT_ADDRESS_MAINNET` being unset — configuration, not a
 * gate, and configuration that is on the deploy checklist. This is that door,
 * and it is the faucet's (`lib/faucet-auth.ts`) with the nouns changed on
 * purpose: two gates that answer the same question in two shapes is how one of
 * them ends up wrong.
 *
 * ## The rule the flag does not waive
 *
 * `REAL_MODE_OPEN_TO_ALL` drops the allowlist. It does **not** drop the
 * signature — "anybody may pay" and "nobody has to prove who they are" are
 * different sentences, and only the first one was asked for. The wallet still
 * signs, which costs a logged-in shopper nothing and costs a script the whole
 * exercise. `faucet-auth.ts:28-36` says the same thing about play money; this
 * rail mints a card against real USDC, so it matters more here, not less.
 *
 * Mode `'open'` — non-production with no list — is the only one that skips the
 * signature. That is what keeps `next dev` painless, and it is unreachable in
 * production, where an empty list means `'disabled'`.
 *
 * ## What this deliberately does not answer
 *
 * Whether the network is *configured*. `denyNetwork` bundles that in, but the
 * deposit route already refuses a missing operator address with a 503 and a log
 * naming the variable, which is the more useful answer for the only person who
 * can fix it. Answering twice in two wordings is how they drift apart.
 *
 * The ordering property `network-access.ts:116-119` cares about survives
 * anyway, because it is an ordering and not a function: this gate runs first,
 * so a stranger is refused before the route ever reaches the question of
 * whether there is anything deployed to reach.
 */

export type RealModeAuth =
  | { ok: true; mode: RealModeMode }
  | { ok: false; status: 401 | 403; error: string; message: string };

const deny = (status: 401 | 403, error: string, message: string): RealModeAuth => ({
  ok: false,
  status,
  error,
  message,
});

/**
 * The whole decision, before a quote is fetched or a card is minted. Cheapest
 * checks first: a stranger is refused on their own claimed address, without
 * touching crypto.
 *
 * The address is a claim until the proof below verifies it, which is why the
 * allowlist is consulted against the claim and the signature is what makes the
 * claim binding. A caller that passes the allowlist with someone else's address
 * cannot produce their signature.
 */
export function authorizeRealMode(args: {
  address: string;
  proof?: Partial<WalletProof> | null;
  now: number;
  env?: NodeJS.ProcessEnv;
  net?: NetworkId;
}): RealModeAuth {
  const env = args.env ?? process.env;
  const net = args.net ?? DEFAULT_NETWORK;
  const address = args.address.trim().toUpperCase();

  // Testnet lands here as mode 'open' and leaves immediately: it is the
  // default network, it cannot spend anything, and gating it would only stop
  // people from trying the demo.
  const access = networkAccess(address, net, env);

  if (access.mode === 'open') return { ok: true, mode: access.mode };

  // Same error and same sentence as `denyNetwork`, for both 'disabled' and a
  // wallet that is not on the list. Collapsing them is the point: a refusal
  // must not tell a stranger whether a list exists, only that they are not
  // getting through it.
  if (!access.allowed) {
    return deny(403, 'network_not_allowed', 'Esta cuenta no tiene habilitado el modo real.');
  }

  const proof = verifyWalletProof({ intent: 'deposit', address, proof: args.proof, now: args.now });
  if (!proof.ok) {
    if (proof.error === 'proof_missing') {
      return deny(401, 'real_mode_session_required', 'Iniciá sesión con tu cuenta para pagar.');
    }
    if (proof.error === 'proof_expired') {
      return deny(401, 'real_mode_proof_expired', 'La confirmación venció. Probá de nuevo.');
    }
    return deny(401, 'real_mode_proof_invalid', 'No pudimos confirmar tu sesión. Probá de nuevo.');
  }
  return { ok: true, mode: access.mode };
}

/**
 * Which mode this network is in, with no address to ask about.
 *
 * `networkAccess` needs one because it answers `allowed`, and the card route
 * has only a memo at the point where it needs to know whether the binding
 * matters. The default network is 'open' here for the same reason it is there:
 * it is not gated at all.
 */
export function realModeFor(net: NetworkId, env: NodeJS.ProcessEnv = process.env): RealModeMode {
  return networkAccess('', net, env).mode;
}

/** Re-exported so a route needs one import for one concern. See real-mode.ts. */
export { realModeNeedsProof } from './real-mode.ts';
