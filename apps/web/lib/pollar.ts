/**
 * Pollar configuration, and the one decision that depends on it: whether this
 * build has a wallet at all.
 *
 * The chat half of changuito is useful without a wallet — it searches, compares
 * and builds a real cart. So a missing key degrades the app to "everything but
 * paying" rather than breaking the page, which is also what a fresh clone gets
 * before anyone has signed up for a Pollar dashboard.
 *
 * ## One key, and why it is the mainnet one
 *
 * A Pollar dashboard key is network-scoped, so the two networks are two
 * different clients holding two different sessions. We only have the mainnet
 * one, and that is not a gap to be filled later — it is the shape of the
 * product. Signing in means production means mainnet (lib/app-mode.ts), so the
 * only login there could be is the mainnet login. Preview has no wallet
 * because preview has nobody: we pay for it ourselves.
 *
 * `LOGIN_NETWORK` is therefore not `DEFAULT_NETWORK`. They used to be the same
 * value and the difference is load-bearing now: DEFAULT_NETWORK is testnet, so
 * `pollarEnabledOn(DEFAULT_NETWORK)` asks "is there a testnet key", the answer
 * is permanently no, and anything gating a login on it would render an app
 * nobody can ever sign into.
 *
 * They are separate `NEXT_PUBLIC_` variables rather than one variable read at
 * runtime because Next inlines these at build time: a name assembled from a
 * variable would inline as nothing.
 */
import { type NetworkId } from './deployments.ts';

/** The network a session belongs to. See the header: this is not the default. */
export const LOGIN_NETWORK: NetworkId = 'mainnet';

const KEYS: Record<NetworkId, string> = {
  testnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
  mainnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
};

export function pollarApiKey(net: NetworkId = LOGIN_NETWORK): string {
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
 * because the network follows the session and the session cannot exist before
 * the key does.
 */
export const pollarEnabled = pollarEnabledOn(LOGIN_NETWORK);

/**
 * Our network ids and Pollar's happen to be the same two words. The map exists
 * so that stays a fact we asserted rather than one we assumed.
 */
const POLLAR_NETWORKS: Record<NetworkId, 'testnet' | 'mainnet'> = {
  testnet: 'testnet',
  mainnet: 'mainnet',
};

export function pollarNetwork(net: NetworkId = LOGIN_NETWORK): 'testnet' | 'mainnet' {
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
