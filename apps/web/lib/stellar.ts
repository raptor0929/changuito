/**
 * Everything this app knows about talking to a Stellar network.
 *
 * Deliberately thin: an RPC handle, the friendbot dance, unit maths for a
 * 7-decimal token, and explorer links. Contract calls live in lib/escrow.ts on
 * top of the generated bindings.
 *
 * Every function that reaches a chain takes a `NetworkId`. It defaults to
 * `DEFAULT_NETWORK` so a caller that has not been threaded yet still compiles
 * — and, more to the point, so a caller that *forgets* lands on testnet, which
 * is the only failure direction that cannot spend somebody's money.
 */
import { Horizon, rpc, StrKey } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, DEPLOYMENTS, type NetworkId } from './deployments.ts';

/**
 * One server per network per process — same memoisation as before, just keyed.
 * A single `let` froze the app to whichever network asked first, which was
 * invisible while there was only one.
 */
const _rpc = new Map<NetworkId, rpc.Server>();
export function rpcServer(net: NetworkId = DEFAULT_NETWORK): rpc.Server {
  let s = _rpc.get(net);
  if (!s) {
    s = new rpc.Server(DEPLOYMENTS[net].rpcUrl);
    _rpc.set(net, s);
  }
  return s;
}

const _horizon = new Map<NetworkId, Horizon.Server>();
export function horizon(net: NetworkId = DEFAULT_NETWORK): Horizon.Server {
  let s = _horizon.get(net);
  if (!s) {
    s = new Horizon.Server(DEPLOYMENTS[net].horizonUrl);
    _horizon.set(net, s);
  }
  return s;
}

export function horizonUrl(net: NetworkId = DEFAULT_NETWORK): string {
  return DEPLOYMENTS[net].horizonUrl;
}

// ------------------------------------------------------------------ funding

export interface FundingResult {
  address: string;
  /** True when friendbot created the account on this call. */
  created: boolean;
  /** XLM balance after the call, as a decimal string. */
  xlm: string;
}

/**
 * Below this we go back to friendbot. Existing-and-non-empty is not the test:
 * Pollar creates its wallets with a sponsored createAccount at a "0" starting
 * balance, so the account is very much there while holding nothing, and a
 * wallet that cannot pay a fee is no better than one that does not exist.
 */
export const MIN_XLM = 5;

/**
 * Makes sure an address can pay a fee.
 *
 * A Stellar address is just a public key until some existing account pays its
 * reserve; until then every transaction it signs fails with `tx_no_source_
 * account`, which reads like a bug in the app rather than an empty wallet. So
 * the first thing the faucet does for a new shopper is ask friendbot for the
 * XLM, and only then mint them demo USDC — a wallet holding USDC it cannot
 * afford to spend is worse than no wallet at all.
 *
 * Idempotent: an account already holding MIN_XLM short-circuits to a balance
 * read, and a friendbot that answers "already funded" is treated as success,
 * because two clicks on [Fund] is a thing people do.
 *
 * Testnet only, and the type says so: `friendbotUrl` is null everywhere else,
 * because there is no such thing as free money on a public network.
 */
export async function ensureFunded(address: string, net: NetworkId = DEFAULT_NETWORK): Promise<FundingResult> {
  const friendbot = DEPLOYMENTS[net].friendbotUrl;
  if (!friendbot) throw new Error(`no hay friendbot en ${net}`);

  const existing = await nativeBalance(address, net);
  if (existing !== null && Number(existing) >= MIN_XLM) {
    return { address, created: false, xlm: existing };
  }

  // Friendbot both creates a missing account and tops up an existing one that
  // sits below its starting balance — it only refuses when the account is
  // already at or above it ("account already funded to starting balance").
  // Verified on testnet: an account holding 1.5 XLM came back with 10001.5.
  const res = await fetch(`${friendbot}/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    // Between our balance read and this call, another tab may well have funded
    // it. Only a still-missing account means we actually failed.
    const body = await res.text();
    const after = await nativeBalance(address, net);
    if (after === null) {
      throw new Error(`friendbot refused to fund ${address}: ${res.status} ${body.slice(0, 200)}`);
    }
    return { address, created: false, xlm: after };
  }

  const xlm = await nativeBalance(address, net);
  return { address, created: existing === null, xlm: xlm ?? '0' };
}

/** Every balance Horizon lists, or null if the account is not on the ledger. */
export interface AccountBalance {
  asset_type: string;
  balance: string;
  asset_code?: string;
  asset_issuer?: string;
}

export async function accountBalances(
  address: string,
  net: NetworkId = DEFAULT_NETWORK,
): Promise<AccountBalance[] | null> {
  const res = await fetch(`${DEPLOYMENTS[net].horizonUrl}/accounts/${encodeURIComponent(address)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`horizon ${res.status} reading ${address}`);
  const json = (await res.json()) as { balances?: AccountBalance[] };
  return json.balances ?? [];
}

/** The account's XLM, or null if the account does not exist on the ledger yet. */
export async function nativeBalance(address: string, net: NetworkId = DEFAULT_NETWORK): Promise<string | null> {
  const balances = await accountBalances(address, net);
  if (balances === null) return null;
  return balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
}

/**
 * Whether this account can hold the given asset.
 *
 * Only a classic asset needs one, which is exactly why mainnet needs this and
 * testnet does not: contracts/mock_usdc is a pure SEP-41 token with no issuer,
 * so it reaches anybody. Real USDC is a classic asset behind a SAC, and a
 * transfer to an account without a trustline fails.
 */
export function hasTrustline(balances: AccountBalance[], code: string, issuer: string): boolean {
  return balances.some((b) => b.asset_type !== 'native' && b.asset_code === code && b.asset_issuer === issuer);
}

// -------------------------------------------------------------------- units

/**
 * Shared across networks on purpose. Classic Stellar assets are 7-decimal and
 * their SAC reports `decimals() = 7`, so mock USDC and real USDC agree — and a
 * test pins that, because this being module-level is only safe while it holds.
 */
const SCALE = 10n ** BigInt(DEPLOYMENTS[DEFAULT_NETWORK].usdcDecimals);

/**
 * US cents -> token units. Cents because that is what `arsToUsdCents` in the
 * MCP's FX module already returns, and routing money through a float on the way
 * to an i128 is how demos end up off by a stroop.
 */
export function centsToUnits(cents: number): bigint {
  if (!Number.isInteger(cents)) throw new Error(`cents must be a whole number, got ${cents}`);
  return (BigInt(cents) * SCALE) / 100n;
}

export function unitsToCents(units: bigint): number {
  return Number((units * 100n) / SCALE);
}

/** "12.34" — two decimals, because nobody reads seven. */
export function formatUsdc(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = ((abs % SCALE) * 100n) / SCALE;
  return `${neg ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

// ----------------------------------------------------------------- explorer

/** stellar.expert calls mainnet "public", so the segment lives in the config. */
const expert = (net: NetworkId, kind: string, value: string) =>
  `https://stellar.expert/explorer/${DEPLOYMENTS[net].explorerPath}/${kind}/${value}`;

export const explorer = {
  tx: (hash: string, net: NetworkId = DEFAULT_NETWORK) => expert(net, 'tx', hash),
  contract: (id: string, net: NetworkId = DEFAULT_NETWORK) => expert(net, 'contract', id),
  account: (address: string, net: NetworkId = DEFAULT_NETWORK) => expert(net, 'account', address),
};

// ---------------------------------------------------------------- addresses

/**
 * What kind of Stellar address this is, or null if it is not one.
 *
 * Both kinds show up here. A Pollar "internal" wallet is an ordinary G-address;
 * a Pollar smart wallet (passkey) is a deployed contract, so its address starts
 * with C. Our token holds balances for either — Soroban does not care — but
 * only a G-address has a Horizon account with XLM in it, so the caller has to
 * know which one it is holding.
 */
export function addressKind(address: string): 'account' | 'contract' | null {
  if (StrKey.isValidEd25519PublicKey(address)) return 'account';
  if (StrKey.isValidContract(address)) return 'contract';
  return null;
}
