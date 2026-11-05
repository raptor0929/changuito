'use client';

import { WalletType } from '@pollar/core';
import { PollarProvider } from '@pollar/react';
import '@pollar/react/styles.css';
import { useCallback, useState } from 'react';

import { gatedFreighter } from '../lib/freighter-gate.ts';
import { LOGIN_NETWORK, pollarApiKey, pollarEnabled, pollarNetwork } from '../lib/pollar.ts';
import { ModeSync } from './ModeSync';
import { PollarSpanish } from './PollarSpanish';

// Freighter next to email / Google: WalletType.FREIGHTER = 'freighter-native'.
void WalletType.FREIGHTER;

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
 * There is one login network now (lib/pollar.ts), so there is nothing to
 * remount *for*. Worse, remounting would be a trap: the network is derived
 * from the session now, so signing in changes the network, a `key` on the
 * network would remount the provider, remounting drops the session, and
 * dropping the session puts the visitor back in preview — where they can
 * sign in again, forever. The provider must outlive the mode change it causes.
 *
 * Freighter is registered next to the built-in methods (email / Google), gated
 * so an extension pointed at the wrong network cannot open a session.
 *
 * During a production build Pollar logs "PollarClient constructor() called
 * server-side" once per prerendered page. That is expected and harmless: the
 * SDK warns rather than throws, and the instance the server builds is thrown
 * away with the HTML — the browser constructs its own at hydration. Rendering
 * the provider only on the client would change the tree shape between server
 * and client and buy a hydration mismatch instead.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!pollarEnabled || LOGIN_NETWORK === null) return <>{children}</>;

  return <PollarMount network={LOGIN_NETWORK}>{children}</PollarMount>;
}

function PollarMount({ network, children }: { network: 'testnet' | 'mainnet'; children: React.ReactNode }) {
  const [mismatch, setMismatch] = useState<string | null>(null);
  const onMismatch = useCallback((message: string) => setMismatch(message), []);

  return (
    <PollarProvider
      client={{
        apiKey: pollarApiKey(network),
        stellarNetwork: pollarNetwork(network),
        walletAdapters: [gatedFreighter(network)],
      }}
    >
      <PollarSpanish />
      <ModeSync onMismatch={onMismatch} />
      {mismatch ? (
        <p className="wallet-error" role="alert" data-testid="network-mismatch">
          {mismatch}
        </p>
      ) : null}
      {children}
    </PollarProvider>
  );
}
