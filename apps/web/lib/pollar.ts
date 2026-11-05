/**
 * Pollar configuration, and the one decision that depends on it: whether this
 * build has a wallet at all.
 *
 * The chat half of changuito is useful without a wallet — it searches, compares
 * and builds a real cart. So a missing key degrades the app to "everything but
 * paying" rather than breaking the page, which is also what a fresh clone gets
 * before anyone has signed up for a Pollar dashboard.
 *
 * ## The login network follows the key
 *
 * A Pollar dashboard key is network-scoped, so the two networks are two
 * different clients holding two different sessions. Which network a session
 * belongs to is derived from which key is set — never from a second variable
 * that names the network (CLAUDE.md §5). The testnet key takes precedence on
 * purpose: a mainnet key left behind can never turn a deployment into a
 * mainnet one while D1 runs on testnet.
 *
 * Mode (who pays) is a separate fact from network. Mode follows the session
 * (lib/app-mode.ts); network follows the key. A signed-in shopper on testnet
 * is production on testnet — their wallet pays, on play money.
 *
 * They are separate `NEXT_PUBLIC_` variables rather than one variable read at
 * runtime because Next inlines these at build time: a name assembled from a
 * variable would inline as nothing.
 */
import { type NetworkId } from './deployments.ts';

export type PollarKeys = Record<NetworkId, string>;

/**
 * Which network a session can exist on, given the key map.
 *
 * Pure so it can be tested. Testnet wins when both are set. `null` means no
 * login at all.
 */
export function loginNetwork(keys: PollarKeys): NetworkId | null {
  if (keys.testnet.length > 0) return 'testnet';
  if (keys.mainnet.length > 0) return 'mainnet';
  return null;
}

const KEYS: PollarKeys = {
  // Literals — Next inlines these at build time.
  testnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
  mainnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
};

/** The network a session belongs to, or null when this build cannot sign anyone in. */
export const LOGIN_NETWORK: NetworkId | null = loginNetwork(KEYS);

export function pollarApiKey(net: NetworkId): string {
  return KEYS[net];
}

/** Whether this build can show a wallet on that network at all. */
export function pollarEnabledOn(net: NetworkId): boolean {
  return KEYS[net].length > 0;
}

/**
 * Whether this build can sign anybody in at all.
 *
 * Read at module scope by WalletWidget, WalletProvider and Chat so the
 * with-wallet / without-wallet split is a build-time constant and hook order
 * can never change — see the note in WalletProvider. It asks about
 * LOGIN_NETWORK and not about whichever network the app happens to be showing,
 * because the network follows the key and the session cannot exist before
 * the key does.
 */
export const pollarEnabled = LOGIN_NETWORK !== null;

/**
 * Our network ids and Pollar's happen to be the same two words. The map exists
 * so that stays a fact we asserted rather than one we assumed.
 */
const POLLAR_NETWORKS: Record<NetworkId, 'testnet' | 'mainnet'> = {
  testnet: 'testnet',
  mainnet: 'mainnet',
};

export function pollarNetwork(net: NetworkId): 'testnet' | 'mainnet' {
  return POLLAR_NETWORKS[net];
}

/**
 * `GDMK…7ZQ4` — the middle of a Stellar address carries no information for a
 * person, and the ends are what they compare against their wallet.
 */
export function shortAddress(address: string, keep = 4): string {
  if (address.length <= keep * 2 + 1) return address;
  return `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
