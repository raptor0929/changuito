'use client';

import { PollarProvider } from '@pollar/react';
import '@pollar/react/styles.css';

import { pollarApiKey, pollarEnabledOn, pollarNetwork } from '../lib/pollar.ts';
import { useNetwork } from './NetworkProvider';
import { PollarSpanish } from './PollarSpanish';

/**
 * Wraps the app in Pollar, or doesn't.
 *
 * `pollarEnabledOn` reads build-time constants (NEXT_PUBLIC_ variables are
 * inlined), so each branch is fixed for the life of the bundle. Without a key
 * the children render exactly as they are: chat, search and cart all work, and
 * only the paying half is missing.
 *
 * `key={network}` is load-bearing. A Pollar dashboard key is network-scoped,
 * so the two modes are two different clients holding two different sessions;
 * changing the prop on a live provider would leave it talking to one chain
 * with the other one's key. Remounting logs the user out of the mode they
 * left, which is correct — those are different accounts with different money.
 *
 * During a production build Pollar logs "PollarClient constructor() called
 * server-side" once per prerendered page. That is expected and harmless: the
 * SDK warns rather than throws, and the instance the server builds is thrown
 * away with the HTML — the browser constructs its own at hydration. Rendering
 * the provider only on the client would change the tree shape between server
 * and client and buy a hydration mismatch instead.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { network } = useNetwork();
  if (!pollarEnabledOn(network)) return <>{children}</>;

  return (
    <PollarProvider
      key={network}
      client={{ apiKey: pollarApiKey(network), stellarNetwork: pollarNetwork(network) }}
    >
      <PollarSpanish />
      {children}
    </PollarProvider>
  );
}
