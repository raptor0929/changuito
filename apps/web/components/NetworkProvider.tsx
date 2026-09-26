'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { DEFAULT_NETWORK, type NetworkId } from '../lib/deployments.ts';

/**
 * Which network the app is on — and therefore which mode it is in.
 *
 * It used to be a choice: a toggle in the masthead, remembered in
 * localStorage, validated on the way back in. It is not a choice any more.
 * The mode follows the Pollar session (lib/app-mode.ts), so the network is
 * *derived*, and this holds the derived value rather than deciding it.
 *
 * The provider still sits above the Pollar provider, because Pollar needs a
 * key and a chain before it can mount. What changed is that it no longer
 * *decides*: `ModeSync`, which lives inside Pollar where `isAuthenticated`
 * can be read, pushes the answer back up here. The layering is the same and
 * the direction of the arrow is reversed — the precedent for that shape is
 * WalletWidget, which has always corrected the network from inside.
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
 * `reachable()` is gone with it. It existed because "a mode with no Pollar
 * key has no wallet, and a wallet is where the mode control lives" — true of
 * a control that no longer exists.
 */

interface NetworkState {
  network: NetworkId;
  /**
   * Set by `ModeSync` and by nothing else. It is on the context because the
   * component that knows the answer is mounted below the one that holds it,
   * not because callers are invited to pick a mode.
   */
  setNetwork: (net: NetworkId) => void;
}

const Ctx = createContext<NetworkState>({ network: DEFAULT_NETWORK, setNetwork: () => {} });

export function useNetwork(): NetworkState {
  return useContext(Ctx);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  // DEFAULT_NETWORK is testnet, which is preview, which is what a visitor
  // with no session gets — so the first paint is already correct and stays
  // correct until Pollar says otherwise. Nothing is read from storage during
  // render, so the server's HTML and the browser's first paint agree.
  const [network, setStored] = useState<NetworkId>(DEFAULT_NETWORK);

  const setNetwork = useCallback((net: NetworkId) => {
    setStored((current) => (current === net ? current : net));
  }, []);

  const value = useMemo(() => ({ network, setNetwork }), [network, setNetwork]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
