/**
 * Which of the two apps this is: preview or production.
 *
 * Changuito ships as one bundle that behaves as two products, and the line
 * between them is **whether Pollar has a session** — nothing else. Not a
 * toggle, not a deployment, not an environment variable somebody can set
 * wrong. Signing in *is* the crossing.
 *
 *   preview     nobody logged in   testnet   we pay, from a wallet we hold
 *   production  Pollar session     mainnet   they pay, from theirs
 *
 * Deriving it from the session rather than offering it as a choice deletes a
 * whole class of bug: the mode cannot disagree with who you are. A remembered
 * "modo real" belonging to a visitor who is not signed in is not a preference,
 * it is a lie the UI would then have to keep — and every server route would
 * have to re-litigate it against the identity it can actually see.
 *
 * The network is the *consequence* of the mode, so this module owns the map
 * both ways and nothing else derives it independently. Pollar sells one public
 * key per network and only the mainnet one exists, which is why there is no
 * logged-in testnet: an account on testnet would need a key we do not have.
 *
 * No imports beyond the network id, and no `process.env`: the browser and the
 * server must agree on this, and the only input is a network id both already
 * have.
 */
import type { NetworkId } from './deployments.ts';

export type AppMode = 'preview' | 'production';

const NETWORK: Record<AppMode, NetworkId> = {
  preview: 'testnet',
  production: 'mainnet',
};

/** The network a mode runs on. */
export function networkFor(mode: AppMode): NetworkId {
  return NETWORK[mode];
}

/**
 * The mode a network implies.
 *
 * Written as a lookup against the map above rather than `net === 'mainnet'`
 * so the two directions cannot drift, and so a third network added to
 * deployments.json is a type error here rather than a silent `preview`.
 */
export function appMode(net: NetworkId): AppMode {
  const found = (Object.keys(NETWORK) as AppMode[]).find((m) => NETWORK[m] === net);
  return found ?? 'preview';
}

/** The mode a visitor is in, given whether Pollar has a session for them. */
export function modeForSession(signedIn: boolean): AppMode {
  return signedIn ? 'production' : 'preview';
}

/**
 * Whether this mode keeps records.
 *
 * Preview never touches Postgres. Mostly that is already true by accident of
 * there being no identity — `archiveChat` refuses a guest, `card_owner` needs
 * a proven address, an order belongs to somebody — but an invariant that holds
 * by coincidence is one refactor away from not holding, so the write sites ask
 * this out loud instead.
 */
export function modeKeepsRecords(net: NetworkId): boolean {
  return appMode(net) === 'production';
}
