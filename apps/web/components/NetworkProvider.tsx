'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { asNetwork, DEFAULT_NETWORK, type NetworkId } from '../lib/deployments.ts';
import { pollarEnabledOn } from '../lib/pollar.ts';

/**
 * Which mode the app is in — prueba or real — and nothing else.
 *
 * It sits *above* the Pollar provider, because the network decides which
 * Pollar key and which chain that provider is built with, and a provider
 * cannot read a context that lives inside it. That also means this component
 * cannot know who is logged in: permission is decided by whoever is inside
 * (WalletWidget), which calls `setNetwork` and, if the answer turns out to be
 * no, calls it back. See lib/network-access.ts for where the real decision is
 * made, on the server, against a signature.
 *
 * The choice is remembered so a reload does not drop somebody back into the
 * other mode mid-order — but it is remembered as a *hint*, validated on the
 * way in. localStorage is a place a person can type, and an unknown string
 * must land on the mode that cannot spend anything.
 */

/**
 * A mode with no Pollar key has no wallet, and a wallet is where the mode
 * control lives — so entering one would strand the user in a mode with no
 * way back out of it. The check belongs here rather than in the toggle
 * because a value restored from storage never passes through the toggle.
 */
function reachable(net: NetworkId): boolean {
  return net === DEFAULT_NETWORK || pollarEnabledOn(net);
}

const STORAGE_KEY = 'changuito:modo';

interface NetworkState {
  network: NetworkId;
  setNetwork: (net: NetworkId) => void;
}

const Ctx = createContext<NetworkState>({ network: DEFAULT_NETWORK, setNetwork: () => {} });

export function useNetwork(): NetworkState {
  return useContext(Ctx);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  // Starts at the default on both sides of hydration. Reading storage during
  // render would make the server's HTML and the browser's first paint
  // disagree, and React would throw the whole tree away to fix it.
  const [network, setStored] = useState<NetworkId>(DEFAULT_NETWORK);

  useEffect(() => {
    try {
      const saved = asNetwork(window.localStorage.getItem(STORAGE_KEY));
      if (saved && saved !== DEFAULT_NETWORK && reachable(saved)) setStored(saved);
    } catch {
      // Safari in private mode throws on localStorage. The default is right.
    }
  }, []);

  const setNetwork = useCallback((net: NetworkId) => {
    if (!reachable(net)) return;
    setStored(net);
    try {
      window.localStorage.setItem(STORAGE_KEY, net);
    } catch {
      // Not remembering the choice is survivable; failing to make it is not.
    }
  }, []);

  const value = useMemo(() => ({ network, setNetwork }), [network, setNetwork]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
