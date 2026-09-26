'use client';

import { usePollar } from '@pollar/react';
import { useEffect } from 'react';

import { modeForSession, networkFor } from '../lib/app-mode.ts';
import { useNetwork } from './NetworkProvider';

/**
 * Tells the app which mode it is in, by watching who is signed in.
 *
 * Renders nothing. It exists because the two facts live on opposite sides of
 * the Pollar provider: `isAuthenticated` is only readable *inside* it, and the
 * network is held *above* it — Pollar needs a chain to mount with, so it
 * cannot be the thing that decides the chain. This component is mounted
 * inside and writes upward, which is the only direction available.
 *
 * Kept as its own component rather than an effect inside WalletWidget for two
 * reasons. The mode is not a masthead concern — the checkout and the chat both
 * read it, and a widget that happens to be on screen is a poor owner for
 * something they depend on. And WalletWidget can be absent (no key, no
 * wallet), which would leave the mode unset in exactly the build where getting
 * it wrong is least recoverable.
 */
export function ModeSync() {
  const { isAuthenticated } = usePollar();
  const { setNetwork } = useNetwork();

  useEffect(() => {
    setNetwork(networkFor(modeForSession(isAuthenticated)));
  }, [isAuthenticated, setNetwork]);

  return null;
}
