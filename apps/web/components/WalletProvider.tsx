'use client';

import { PollarProvider } from '@pollar/react';
import '@pollar/react/styles.css';

import { DEFAULT_NETWORK } from '../lib/deployments.ts';
import { pollarApiKey, pollarEnabled, pollarNetwork } from '../lib/pollar.ts';
import { PollarSpanish } from './PollarSpanish';

/**
 * Wraps the app in Pollar, or doesn't.
 *
 * `pollarEnabled` is a build-time constant (NEXT_PUBLIC_ variables are inlined),
 * so this branch is fixed for the life of the bundle and no hook order can
 * change under it. Without a key the children render exactly as they are: chat,
 * search and cart all work, and only the paying half is missing.
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
    <PollarProvider client={{ apiKey: pollarApiKey(DEFAULT_NETWORK), stellarNetwork: pollarNetwork(DEFAULT_NETWORK) }}>
      <PollarSpanish />
      {children}
    </PollarProvider>
  );
}
