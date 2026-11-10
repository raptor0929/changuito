'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useMemo } from 'react';

import { openThroughChannels } from '../lib/channels-open.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { useWalletSigners } from '../lib/use-wallet-signers.ts';
import { WalletContext, type WalletState } from '../lib/use-wallet.ts';
import { useNetwork } from './NetworkProvider';

/**
 * The one wallet the copied shopper talks to. Pollar and Freighter stay
 * behind it: `useWallet()` is the surface, and opening an order is the
 * escrow call the buyer signs, the same one PaymentModal already uses.
 */
export function WalletBridge({ children }: { children: React.ReactNode }) {
  const { wallet, isAuthenticated, openLoginModal, logout, configStatus } = usePollar();
  const sign = useWalletSigner();
  const { signAuthEntry } = useWalletSigners();
  const { network } = useNetwork();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;

  const openEscrow = useCallback(async (order: {
    orderId: string;
    amount: string;
    basketHash: string;
    timeoutSecs: number;
  }) => {
    if (!address) throw new Error('wallet unavailable');
    const res = await fetch(`/api/contracts?network=${network}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null) as { escrowId?: string; error?: string } | null;
    if (!res.ok || typeof json?.escrowId !== 'string') {
      throw new Error(json?.error ?? 'contracts failed');
    }
    // The buyer signs an auth entry. Channels pays the fee and is the source.
    return openThroughChannels({
      network,
      contractId: json.escrowId,
      method: 'open',
      orderId: order.orderId,
      amount: order.amount,
      basketHash: order.basketHash,
      timeoutSecs: order.timeoutSecs,
      signAuthEntry,
    });
  }, [address, network, signAuthEntry]);

  const value = useMemo<WalletState>(() => ({
    enabled: true,
    ready: configStatus === 'ready' || configStatus === 'error' || isAuthenticated,
    authenticated: Boolean(address),
    androidChoices: false,
    kind: 'off',
    address,
    email: null,
    login: () => { openLoginModal(); },
    loginMobile: async () => {},
    logout: async () => { await logout(); },
    accessToken: sign,
    signTransaction: async () => { throw new Error('wallet unavailable'); },
    openEscrow,
  }), [address, configStatus, isAuthenticated, logout, openEscrow, openLoginModal, sign]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
