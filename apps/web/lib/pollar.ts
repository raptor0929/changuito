/**
 * Pollar configuration, and the one decision that depends on it: whether this
 * build has a wallet at all.
 *
 * The chat half of changuito is useful without a wallet — it searches, compares
 * and builds a real cart. So a missing key degrades the app to "everything but
 * paying" rather than breaking the page, which is also what a fresh clone gets
 * before anyone has signed up for a Pollar dashboard.
 */
export const POLLAR_API_KEY = process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '';

export const pollarEnabled = POLLAR_API_KEY.length > 0;

/** Testnet, always. See the note in lib/deployments.ts. */
export const POLLAR_NETWORK = 'testnet' as const;

/**
 * `GDMK…7ZQ4` — the middle of a Stellar address carries no information for a
 * person, and the ends are what they compare against their wallet.
 */
export function shortAddress(address: string, keep = 4): string {
  if (address.length <= keep * 2 + 1) return address;
  return `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
