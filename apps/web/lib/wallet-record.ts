/**
 * The `wallet` table: one row per address that has signed in.
 *
 * Written at login, after the SEP-53 proof and before the cookie. A missing
 * database, or a migration that has not been applied yet, does not refuse
 * the login: the row is how an operator manages the wallet afterwards, and
 * a shop that cannot reach Postgres still has to let a proven wallet in.
 * A row that says `banned` does refuse the cookie.
 *
 * Its relative imports name their extension, so the module loads under
 * `node --experimental-strip-types`.
 */
import type { NetworkId } from './deployments.ts';
import { DEFAULT_NETWORK } from './deployments.ts';
import { db, hasDatabase } from './db.ts';
import { loginNetwork } from './pollar.ts';

export interface WalletStanding {
  network: NetworkId;
  faucetAllowed: boolean;
  banned: boolean;
  /** False when this process did not read or write a row. */
  stored: boolean;
}

const OPEN = { faucetAllowed: false, banned: false, stored: false } as const;

export function walletNetwork(env: NodeJS.ProcessEnv = process.env): NetworkId {
  return (
    loginNetwork({
      testnet: env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
      mainnet: env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
    }) ?? DEFAULT_NETWORK
  );
}

function standingOf(network: NetworkId, row: { faucet_allowed: boolean; banned: boolean }): WalletStanding {
  return { network, faucetAllowed: row.faucet_allowed === true, banned: row.banned === true, stored: true };
}

/**
 * Insert the wallet the first time it signs in. An existing row is returned
 * unchanged, including a ban or a faucet grant written before this login.
 */
export async function registerWallet(
  address: string,
  env: NodeJS.ProcessEnv = process.env,
  network: NetworkId = walletNetwork(env),
): Promise<WalletStanding> {
  if (!hasDatabase(env)) return { network, ...OPEN };
  try {
    const inserted = await db(env)`
      insert into wallet (network, address)
      values (${network}, ${address})
      on conflict (network, address) do nothing
      returning faucet_allowed, banned`;
    if (inserted.length > 0) return standingOf(network, inserted[0] as { faucet_allowed: boolean; banned: boolean });
    const existing = await db(env)`
      select faucet_allowed, banned from wallet
      where network = ${network} and address = ${address}`;
    const row = existing[0] as { faucet_allowed: boolean; banned: boolean } | undefined;
    if (!row) return { network, ...OPEN };
    return standingOf(network, row);
  } catch (err) {
    console.warn('[wallet] register failed; login continues:', err instanceof Error ? err.message : err);
    return { network, ...OPEN };
  }
}

/** `config.faucet_open_to_all`. Missing row, missing table and no database are false. */
export async function faucetOpenToAll(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!hasDatabase(env)) return false;
  try {
    const rows = await db(env)`select value from config where key = 'faucet_open_to_all'`;
    const value = rows[0]?.value;
    return value === true || value === 'true';
  } catch {
    return false;
  }
}

/**
 * The database can open the faucet for a wallet the env allowlist does not
 * know. It never opens it for a banned wallet, and it never replaces a
 * refusal that is about the network or the signature.
 */
export function walletOpensFaucet(
  standing: Pick<WalletStanding, 'banned' | 'faucetAllowed'>,
  openToAll: boolean,
  envError: string,
): boolean {
  if (standing.banned) return false;
  if (envError !== 'faucet_disabled' && envError !== 'faucet_not_allowed') return false;
  return openToAll || standing.faucetAllowed;
}
