import { Contract, JsonRpcProvider, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';

import type { AppConfig } from '../config.js';
import { setupRef } from '../onboarding.js';
import { log } from '../secure/redact.js';
import { readAddress, withSigner } from './keystore.js';

/**
 * Moving money from the user's own EOA to the Vyrion custodial deposit address.
 *
 * The rule that shapes this file: **it never blocks a purchase.** A transfer is
 * signed, broadcast, and the hash is returned — we do not wait for
 * confirmations, and no checkout ever waits on a block. The wallet holds what
 * it holds; a top-up covers the *next* order, not this one. That is why
 * `decideFunding` counts settled balance only and why nothing here is awaited
 * from the payment path.
 *
 * The key is decrypted for exactly one signature, inside `withSigner`.
 */

/** Minimal ERC-20 surface. Nothing here approves or delegates. */
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

/** Well-known USDT contracts, so the common case needs no configuration. */
const USDT: Record<number, string> = {
  1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum mainnet
  137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
  42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum One
};

export interface EvmContext {
  provider: JsonRpcProvider;
  /** The token contract, or undefined when sending native ETH. */
  token?: Contract;
  decimals: number;
  symbol: string;
}

export function requireRpc(cfg: AppConfig): string {
  if (!cfg.wallet.rpcUrl) {
    throw new Error(
      'RPC_URL is not set, so I cannot read your wallet or send a top-up. ' +
        `${setupRef('Crypto wallet')} Everything else works without it.`,
    );
  }
  return cfg.wallet.rpcUrl;
}

export function tokenAddress(cfg: AppConfig): string | undefined {
  if (cfg.wallet.asset === 'eth') return undefined;
  const addr = cfg.wallet.usdtAddress ?? USDT[cfg.wallet.chainId];
  if (!addr) {
    throw new Error(
      `No USDT contract known for chain ${cfg.wallet.chainId}. Set USDT_ADDRESS, ` +
        'or set FUNDING_ASSET=eth.',
    );
  }
  return getAddress(addr);
}

export async function connect(cfg: AppConfig): Promise<EvmContext> {
  const provider = new JsonRpcProvider(requireRpc(cfg), cfg.wallet.chainId);
  const addr = tokenAddress(cfg);
  if (!addr) return { provider, decimals: 18, symbol: 'ETH' };

  const token = new Contract(addr, ERC20_ABI, provider);
  const [decimals, symbol] = await Promise.all([
    token.decimals!().then(Number).catch(() => 6),
    token.symbol!().catch(() => 'USDT'),
  ]);
  return { provider, token, decimals, symbol: String(symbol) };
}

export interface WalletView {
  address: string;
  /** Token (or ETH) balance, human-readable. */
  balance: string;
  symbol: string;
  /** Native balance, needed for gas even when sending a token. */
  gasBalance: string;
  /** False when there is not enough native currency to pay for a transfer. */
  canPayGas: boolean;
}

/**
 * Read-only, and deliberately passphrase-free: a keystore carries its address
 * in the clear, so checking a balance never asks for the secret.
 */
export async function viewWallet(cfg: AppConfig): Promise<WalletView> {
  const address = await readAddress(cfg.keystorePath);
  const ctx = await connect(cfg);

  const native = await ctx.provider.getBalance(address);
  const balance = ctx.token
    ? formatUnits(await ctx.token.balanceOf!(address), ctx.decimals)
    : formatUnits(native, 18);

  return {
    address,
    balance,
    symbol: ctx.symbol,
    gasBalance: formatUnits(native, 18),
    // A token transfer with an empty gas tank fails at broadcast; saying so
    // first is cheaper than a failed transaction the user has to interpret.
    canPayGas: native > 0n,
  };
}

export interface TransferRequest {
  to: string;
  /** Human units, as the user said it: "20" means 20 USDT, not 20 wei. */
  amount: string;
  passphrase: string;
}

export interface TransferReceipt {
  hash: string;
  from: string;
  to: string;
  amount: string;
  symbol: string;
  chainId: number;
  explorerUrl?: string;
  /** Always false here, by design. */
  confirmed: boolean;
}

const EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  42161: 'https://arbiscan.io/tx/',
};

/**
 * Sign and broadcast a transfer, then return immediately.
 *
 * `tx.wait()` is never called: waiting for a confirmation is what would drag
 * block times into a grocery checkout. The hash is enough for the user to watch
 * it themselves, and the funding decision only ever trusts Vyrion's *settled*
 * balance anyway.
 */
export async function sendFunds(cfg: AppConfig, req: TransferRequest): Promise<TransferReceipt> {
  const to = normalizeRecipient(req.to);
  const ctx = await connect(cfg);
  const amount = parseAmount(req.amount, ctx.decimals);

  return withSigner({ path: cfg.keystorePath, passphrase: req.passphrase }, async (wallet) => {
    const signer = wallet.connect(ctx.provider);
    const from = await signer.getAddress();

    const tx = ctx.token
      ? await (ctx.token.connect(signer) as Contract).transfer!(to, amount)
      : await signer.sendTransaction({ to, value: amount });

    log(`[evm] broadcast ${req.amount} ${ctx.symbol} -> ${to} (${tx.hash}); not waiting for confirmation`);
    return {
      hash: tx.hash,
      from,
      to,
      amount: formatUnits(amount, ctx.decimals),
      symbol: ctx.symbol,
      chainId: cfg.wallet.chainId,
      explorerUrl: EXPLORERS[cfg.wallet.chainId]
        ? `${EXPLORERS[cfg.wallet.chainId]}${tx.hash}`
        : undefined,
      confirmed: false,
    };
  });
}

/**
 * A mistyped recipient is an irreversible loss, so this is strict: a checksummed
 * EIP-55 address or nothing. It is also where a Stellar address would be caught
 * — Vyrion's deposit networks are BTC/ETH/SOL/USDT, and this repository's name
 * notwithstanding, there is no XLM path.
 */
export function normalizeRecipient(to: string): string {
  const trimmed = to.trim();
  if (!isAddress(trimmed)) {
    throw new Error(
      `"${trimmed}" is not an EVM address. Use the deposit address Vyrion gave you for ` +
        'this asset — sending to the wrong network loses the funds permanently.',
    );
  }
  return getAddress(trimmed);
}

export function parseAmount(amount: string, decimals: number): bigint {
  const value = parseUnits(amount.trim(), decimals);
  if (value <= 0n) throw new Error('The transfer amount must be greater than zero.');
  return value;
}

/** What the user is asked to restate before a transfer goes out. */
export function describeTransfer(view: WalletView, to: string, amount: string): string {
  return [
    `From:   ${view.address} (${view.balance} ${view.symbol})`,
    `To:     ${to}`,
    `Amount: ${amount} ${view.symbol}`,
    `Gas:    ${view.gasBalance} ETH available`,
    '',
    'This is broadcast and not waited on. The hash comes back immediately; the',
    'deposit becomes spendable at Vyrion once it confirms, which is minutes, not',
    'seconds. It does not hold up an order you are paying for now.',
  ].join('\n');
}
