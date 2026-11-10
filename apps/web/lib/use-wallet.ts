'use client';

import { createContext, useContext } from 'react';

import type { WalletSigner } from './wallet-proof.ts';

/**
 * The one wallet surface the app sees. Privy lives behind it
 * (components/WalletProvider.tsx), so no component imports a Privy hook and a
 * build without NEXT_PUBLIC_PRIVY_APP_ID renders the same tree with
 * `enabled: false` — chat, search and cart work, paying does not.
 *
 * It is a context rather than a hook over Privy's hooks because those hooks
 * throw outside a PrivyProvider, and whether there is one is a build-time
 * fact. A context default is the cheapest way to keep hook order fixed.
 */
export interface WalletState {
  /** Sign-in can happen: Privy is configured, or this is the phone-only shell. */
  enabled: boolean;
  /** Privy finished restoring its session, or the phone session check finished. */
  ready: boolean;
  authenticated: boolean;
  /**
   * Android, including the Seeker shell. Email, Google and the phone
   * account are all offered. Privy stays mounted.
   */
  androidChoices: boolean;
  /**
   * `privy` is an embedded or linked external wallet authenticated by Privy. `mobile` is a phone wallet that signed
   * the server's message. `off` is signed out. When both exist, `mobile` wins
   * until the shopper starts a Privy login.
   */
  kind: 'off' | 'privy' | 'mobile';
  /** The account address. Case-sensitive: never upper-case it. */
  address: string | null;
  email: string | null;
  /** Opens Privy. `email` or `google` limits the modal to that one method. */
  login: (method?: 'email' | 'google') => void;
  /** Connect a phone wallet, sign the server challenge, and keep that address. */
  loginMobile: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * SEP-53 signer for the session cookie. The name stays `accessToken`
   * because every copied caller already passes this field into `fetchAs`.
   */
  accessToken: WalletSigner;
  /**
   * Unused on this chain. Opening an order is `openEscrow`: the buyer signs
   * the escrow call, and the server never sees a foreign transaction.
   */
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
  /** Lock this quoted order. Resolves to the transaction hash. */
  openEscrow: (order: { orderId: string; amount: string; basketHash: string; timeoutSecs: number }) => Promise<string>;
}

const missing = async (): Promise<never> => {
  throw new Error('wallet unavailable');
};

export const WALLET_OFF: WalletState = {
  enabled: false,
  ready: true,
  authenticated: false,
  androidChoices: false,
  kind: 'off',
  address: null,
  email: null,
  login: () => {},
  loginMobile: async () => {},
  logout: async () => {},
  accessToken: async () => null,
  signTransaction: missing,
  openEscrow: missing,
};

export const WalletContext = createContext<WalletState>(WALLET_OFF);

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

/** `9rYN…tdMM` — the ends are what a person compares. */
export function shortAddress(address: string, keep = 4): string {
  if (address.length <= keep * 2 + 1) return address;
  return `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
