/**
 * Pollar configuration, and the one decision that depends on it: whether this
 * build has a wallet at all.
 *
 * The chat half of changuito is useful without a wallet — it searches, compares
 * and builds a real cart. So a missing key degrades the app to "everything but
 * paying" rather than breaking the page, which is also what a fresh clone gets
 * before anyone has signed up for a Pollar dashboard.
 *
 * One key per network, because a Pollar dashboard key is itself network-scoped
 * (DEPLOY.md). They are separate `NEXT_PUBLIC_` variables rather than one
 * variable read at runtime because Next inlines these at build time: a name
 * assembled from a variable would inline as nothing.
 */
import { DEFAULT_NETWORK, type NetworkId } from './deployments.ts';

const KEYS: Record<NetworkId, string> = {
  testnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
  mainnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
};

export function pollarApiKey(net: NetworkId = DEFAULT_NETWORK): string {
  return KEYS[net];
}

/** Whether this build can show a wallet on that network at all. */
export function pollarEnabledOn(net: NetworkId): boolean {
  return KEYS[net].length > 0;
}

export const POLLAR_API_KEY = KEYS[DEFAULT_NETWORK];

/**
 * Whether the *default* network has a wallet. Read at module scope by
 * WalletWidget so the connected/disconnected split is a build-time constant and
 * hook order can never change — see the note there.
 */
export const pollarEnabled = pollarEnabledOn(DEFAULT_NETWORK);

/**
 * Our network ids and Pollar's happen to be the same two words. The map exists
 * so that stays a fact we asserted rather than one we assumed.
 */
const POLLAR_NETWORKS: Record<NetworkId, 'testnet' | 'mainnet'> = {
  testnet: 'testnet',
  mainnet: 'mainnet',
};

export function pollarNetwork(net: NetworkId = DEFAULT_NETWORK): 'testnet' | 'mainnet' {
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
