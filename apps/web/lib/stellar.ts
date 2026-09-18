/**
 * Everything this app knows about talking to Stellar testnet.
 *
 * Deliberately thin: an RPC handle, the friendbot dance, unit maths for a
 * 7-decimal token, and explorer links. Contract calls live in lib/escrow.ts on
 * top of the generated bindings.
 */
import { Horizon, rpc, StrKey } from '@stellar/stellar-sdk';

import { DEPLOYMENTS } from './deployments.ts';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

/** One server per process. The RPC client is stateless, so sharing is free. */
let _rpc: rpc.Server | undefined;
export function rpcServer(): rpc.Server {
  _rpc ??= new rpc.Server(DEPLOYMENTS.rpcUrl);
  return _rpc;
}

let _horizon: Horizon.Server | undefined;
export function horizon(): Horizon.Server {
  _horizon ??= new Horizon.Server(HORIZON_URL);
  return _horizon;
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
 * Makes sure an address can pay a fee.
 *
 * A Stellar address is just a public key until some existing account pays its
 * reserve; until then every transaction it signs fails with `tx_no_source_
 * account`, which reads like a bug in the app rather than an empty wallet. So
 * the first thing the faucet does for a new shopper is ask friendbot for the
 * XLM, and only then mint them demo USDC — a wallet holding USDC it cannot
 * afford to spend is worse than no wallet at all.
 *
 * Idempotent: an already-funded account short-circuits to a balance read, and a
 * friendbot that answers "already exists" is treated as success, because two
 * clicks on [Fund] is a thing people do.
 */
export async function ensureFunded(address: string): Promise<FundingResult> {
  const existing = await nativeBalance(address);
  if (existing !== null) return { address, created: false, xlm: existing };

  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    // Friendbot 400s on an account that already exists. Between our balance
    // read and this call, another tab may well have funded it.
    const body = await res.text();
    const after = await nativeBalance(address);
    if (after === null) {
      throw new Error(`friendbot refused to fund ${address}: ${res.status} ${body.slice(0, 200)}`);
    }
    return { address, created: false, xlm: after };
  }

  const xlm = await nativeBalance(address);
  return { address, created: true, xlm: xlm ?? '0' };
}

/** The account's XLM, or null if the account does not exist on the ledger yet. */
export async function nativeBalance(address: string): Promise<string | null> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(address)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`horizon ${res.status} reading ${address}`);
  const json = (await res.json()) as { balances?: { asset_type: string; balance: string }[] };
  return json.balances?.find((b) => b.asset_type === 'native')?.balance ?? '0';
}

// -------------------------------------------------------------------- units

const SCALE = 10n ** BigInt(DEPLOYMENTS.usdcDecimals);

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

export const explorer = {
  tx: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  contract: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
  account: (address: string) => `https://stellar.expert/explorer/testnet/account/${address}`,
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
