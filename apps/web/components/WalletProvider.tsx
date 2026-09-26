'use client';

import { PollarProvider } from '@pollar/react';
import '@pollar/react/styles.css';

import { LOGIN_NETWORK, pollarApiKey, pollarEnabled, pollarNetwork } from '../lib/pollar.ts';
import { ModeSync } from './ModeSync';
import { PollarSpanish } from './PollarSpanish';

/**
 * Wraps the app in Pollar, or doesn't.
 *
 * `pollarEnabled` reads a build-time constant (NEXT_PUBLIC_ variables are
 * inlined), so each branch is fixed for the life of the bundle. Without a key
 * the children render exactly as they are: chat, search and cart all work, and
 * only the paying half is missing.
 *
 * ## There is no `key={network}` here, and putting one back would hang the app
 *
 * There used to be. A Pollar dashboard key is network-scoped, so two modes
 * meant two clients holding two sessions, and remounting on a mode change was
 * correct — those were different accounts with different money.
 *
 * There is one key now, and one network to go with it (lib/pollar.ts), so
 * there is nothing to remount *for*. Worse, remounting would be a trap: the
 * network is derived from the session now, so signing in changes the network,
 * a `key` on the network would remount the provider, remounting drops the
 * session, and dropping the session puts the visitor back in preview — where
 * they can sign in again, forever. The provider must outlive the mode change
 * it causes.
 *
 * It mounts for signed-out visitors too, which is new and is the point:
 * preview has no wallet but it still needs somewhere to sign in *from*, and
 * `ModeSync` has to be able to see the session appear.
 *
 * During a production build Pollar logs "PollarClient constructor() called
 * server-side" once per prerendered page. That is expected and harmless: the
 * SDK warns rather than throws, and the instance the server builds is thrown
 * away with the HTML — the browser constructs its own at hydration. Rendering
 * the provider only on the client would change the tree shape between server
 * and client and buy a hydration mismatch instead.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!pollarEnabled) return <>{children}</>;

  return (
    <PollarProvider
      client={{ apiKey: pollarApiKey(LOGIN_NETWORK), stellarNetwork: pollarNetwork(LOGIN_NETWORK) }}
    >
      <PollarSpanish />
      <ModeSync />
      {children}
    </PollarProvider>
  );
}
