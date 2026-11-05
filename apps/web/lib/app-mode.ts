/**
 * Which of the two apps this is: preview or production.
 *
 * Changuito ships as one bundle that behaves as two products, and the line
 * between them is **whether Pollar has a session** — nothing else. Not a
 * toggle, not a deployment, not an environment variable somebody can set
 * wrong. Signing in *is* the crossing.
 *
 *   preview     nobody logged in   DEFAULT_NETWORK   we pay, from a wallet we hold
 *   production  Pollar session     LOGIN_NETWORK     they pay, from theirs
 *
 * Mode and network are two separate facts. Mode = who pays (the session).
 * Network = which chain the Pollar key was created for (lib/pollar.ts). A
 * signed-in shopper on testnet is production on testnet: their wallet pays,
 * on testnet USDC. Deriving mode from the network would call that preview and
 * refuse to keep records — which is the old rule this module no longer holds.
 *
 * Deriving mode from the session rather than offering it as a choice deletes a
 * whole class of bug: the mode cannot disagree with who you are. A remembered
 * "modo real" belonging to a visitor who is not signed in is not a preference,
 * it is a lie the UI would then have to keep — and every server route would
 * have to re-litigate it against the identity it can actually see.
 *
 * No imports beyond the network id, and no `process.env`: the browser and the
 * server must agree on this, and the only inputs are a signed-in bit and a
 * login network both already have.
 */
import type { NetworkId } from './deployments.ts';

export type AppMode = 'preview' | 'production';

/** The mode a visitor is in, given whether Pollar has a session for them. */
export function modeForSession(signedIn: boolean): AppMode {
  return signedIn ? 'production' : 'preview';
}

/**
 * The network a visitor is on, given whether they are signed in and which
 * network a session can exist on.
 *
 * A guest always lands on `fallback` (DEFAULT_NETWORK — testnet). A session
 * lands on the login network. When there is no login network at all, everybody
 * stays on the fallback: there is nowhere else to go.
 */
export function sessionNetwork(
  signedIn: boolean,
  login: NetworkId | null,
  fallback: NetworkId,
): NetworkId {
  return signedIn && login ? login : fallback;
}

/**
 * Whether this mode keeps records.
 *
 * Preview never touches Postgres. Mostly that is already true by accident of
 * there being no identity — `archiveChat` refuses a guest, `card_owner` needs
 * a proven address, an order belongs to somebody — but an invariant that holds
 * by coincidence is one refactor away from not holding, so the write sites ask
 * this out loud instead.
 *
 * A signed-in session on testnet keeps records. That is safe because the DB is
 * keyed on `(network, address)` / `(network, memo)`, so testnet rows can never
 * collide with mainnet ones.
 */
export function modeKeepsRecords(mode: AppMode): boolean {
  return mode === 'production';
}
