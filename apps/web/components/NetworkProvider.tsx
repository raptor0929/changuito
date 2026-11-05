'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { modeForSession, type AppMode } from '../lib/app-mode.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../lib/deployments.ts';

/**
 * Which network the app is on, and which mode it is in.
 *
 * Mode and network are two separate facts (lib/app-mode.ts). Mode = who pays,
 * derived from the Pollar session. Network = which chain the Pollar key was
 * created for. `ModeSync`, mounted inside Pollar where `isAuthenticated` can
 * be read, pushes both answers back up here.
 *
 * ## What was removed, and why it must not come back
 *
 * The `changuito:modo` localStorage hint is gone. A remembered mode that
 * disagrees with the session is not a preference, it is a lie the UI would
 * then have to keep: a visitor with "modo real" in storage and no session
 * would be shown real-money copy for money they cannot spend, and every
 * server route would refuse them on an identity they do not have. The session
 * is the only authority, and it is re-established on every load anyway.
 *
 * Inferring mode from the network is gone with it. A signed-in session on
 * testnet is production — callers that ask "who pays" read `mode` from this
 * context, never `appMode(network)`.
 */

interface NetworkState {
  network: NetworkId;
  /** Who pays. Derived from the session; never from the network. */
  mode: AppMode;
  /**
   * Set by `ModeSync` and by nothing else. It is on the context because the
   * component that knows the answer is mounted below the one that holds it,
   * not because callers are invited to pick a mode.
   */
  setNetwork: (net: NetworkId) => void;
  setMode: (mode: AppMode) => void;
}

const Ctx = createContext<NetworkState>({
  network: DEFAULT_NETWORK,
  mode: modeForSession(false),
  setNetwork: () => {},
  setMode: () => {},
});

export function useNetwork(): NetworkState {
  return useContext(Ctx);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  // DEFAULT_NETWORK is testnet, which is preview, which is what a visitor
  // with no session gets — so the first paint is already correct and stays
  // correct until Pollar says otherwise. Nothing is read from storage during
  // render, so the server's HTML and the browser's first paint agree.
  const [network, setStored] = useState<NetworkId>(DEFAULT_NETWORK);
  const [mode, setStoredMode] = useState<AppMode>(modeForSession(false));

  const setNetwork = useCallback((net: NetworkId) => {
    setStored((current) => (current === net ? current : net));
  }, []);

  const setMode = useCallback((next: AppMode) => {
    setStoredMode((current) => (current === next ? current : next));
  }, []);

  const value = useMemo(
    () => ({ network, mode, setNetwork, setMode }),
    [network, mode, setNetwork, setMode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
