'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef } from 'react';

import { modeForSession, sessionNetwork } from '../lib/app-mode.ts';
import { DEFAULT_NETWORK } from '../lib/deployments.ts';
import { NETWORK_MISMATCH } from '../lib/mode-copy.ts';
import { LOGIN_NETWORK } from '../lib/pollar.ts';
import { useNetwork } from './NetworkProvider';

/**
 * Tells the app which mode and network it is on, by watching who is signed in.
 *
 * Renders nothing. It exists because the two facts live on opposite sides of
 * the Pollar provider: `isAuthenticated` is only readable *inside* it, and the
 * network is held *above* it — Pollar needs a chain to mount with, so it
 * cannot be the thing that decides the chain. This component is mounted
 * inside and writes upward, which is the only direction available.
 *
 * On login it also checks the session's network against LOGIN_NETWORK. Pollar
 * responses carry `network: 'testnet' | 'mainnet'`. A mismatch means the key
 * and the session disagree — log out and surface the error rather than let
 * the shopper spend on the wrong chain.
 */
export function ModeSync({ onMismatch }: { onMismatch?: (message: string) => void }) {
  const { isAuthenticated, network: pollarNetwork, logout } = usePollar();
  const { setNetwork, setMode } = useNetwork();
  const mismatch = useRef(false);

  useEffect(() => {
    const mode = modeForSession(isAuthenticated);
    setMode(mode);
    setNetwork(sessionNetwork(isAuthenticated, LOGIN_NETWORK, DEFAULT_NETWORK));
  }, [isAuthenticated, setNetwork, setMode]);

  useEffect(() => {
    if (!isAuthenticated || !LOGIN_NETWORK) {
      mismatch.current = false;
      return;
    }
    // Pollar's network id matches ours. Anything else is a session we did not
    // ask for — refuse it before a payment can land on the wrong chain.
    if (pollarNetwork && pollarNetwork !== LOGIN_NETWORK) {
      if (mismatch.current) return;
      mismatch.current = true;
      onMismatch?.(NETWORK_MISMATCH.session);
      logout();
    }
  }, [isAuthenticated, pollarNetwork, logout, onMismatch]);

  return null;
}
