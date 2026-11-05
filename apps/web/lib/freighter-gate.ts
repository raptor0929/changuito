/**
 * Freighter must be on the same network as the Pollar key before a session is
 * accepted. Freighter's `getNetwork()` returns Freighter's own vocabulary
 * (`TESTNET`, `PUBLIC`, …); this maps it onto ours and refuses a mismatch.
 */
import { FreighterAdapter, type ConnectWalletResponse, type WalletAdapter } from '@pollar/core';

import type { NetworkId } from './deployments.ts';
import { NETWORK_MISMATCH } from './mode-copy.ts';

/** Freighter's network string → our id, or null when unrecognised. */
export function freighterNetworkId(raw: string): NetworkId | null {
  const n = raw.trim().toUpperCase();
  if (n === 'TESTNET' || n === 'TEST SDF NETWORK ; SEPTEMBER 2015') return 'testnet';
  if (n === 'PUBLIC' || n === 'PUBLIC GLOBAL STELLAR NETWORK ; SEPTEMBER 2015') return 'mainnet';
  if (n === 'MAINNET') return 'mainnet';
  return null;
}

/**
 * Freighter adapter that refuses to connect when the extension is pointed at
 * a different network from `expected`. Throws a Spanish Error the login UI
 * can show; does not open a session.
 */
export function gatedFreighter(expected: NetworkId): WalletAdapter {
  const inner = new FreighterAdapter();
  return {
    type: inner.type,
    meta: inner.meta,
    custody: inner.custody,
    isAvailable: () => inner.isAvailable(),
    disconnect: () => inner.disconnect(),
    getPublicKey: () => inner.getPublicKey(),
    signTransaction: (xdr, opts) => inner.signTransaction(xdr, opts),
    signAuthEntry: (entry, opts) => inner.signAuthEntry(entry, opts),
    signStellarMessage: (message, opts) => inner.signStellarMessage(message, opts),
    async connect(): Promise<ConnectWalletResponse> {
      const raw = await inner.getNetwork();
      const got = freighterNetworkId(raw);
      if (got !== expected) {
        throw new Error(NETWORK_MISMATCH.freighter);
      }
      return inner.connect();
    },
  };
}
