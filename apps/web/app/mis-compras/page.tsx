import type { Metadata } from 'next';

import { HumanGate } from '../../components/HumanGate';
import { NetworkProvider } from '../../components/NetworkProvider';
import { Purchases } from '../../components/Purchases';
import { WalletProvider } from '../../components/WalletProvider';
import { turnstileSiteKey } from '../../lib/human-gate';

/**
 * /mis-compras — the record, on whichever device the shopper is holding.
 *
 * The same site key read the same way as the home page, and for the same
 * reason: a static prerender bakes `siteKey: ""` and the widget never
 * appears, even once the env var exists at runtime. `POST /api/orders` runs
 * `requireHuman` like every other route, so this page needs the gate as much
 * as the chat does.
 *
 * The providers are the home page's, minus `ShopProvider` and `Deck` — there
 * is no basket and no chat here. `NetworkProvider` above `WalletProvider`
 * because Pollar needs a chain before it can mount, and `ModeSync` inside
 * the latter pushes the derived network back up. Without the pair, `Purchases`
 * would read `DEFAULT_NETWORK` for a signed-in shopper and ask the server for
 * the wrong ledger's orders.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mis compras',
  description: 'Lo que compraste con Changuito, desde cualquier dispositivo.',
  // A page behind a signature has nothing to offer an index, and the URL
  // alone tells a crawler more than it should know.
  robots: { index: false, follow: false },
};

export default function MisCompras() {
  const siteKey = turnstileSiteKey();
  return (
    <NetworkProvider>
      <WalletProvider>
        <main className="page">
          <header className="page-head">
            <a className="page-brand" href="/">
              <img
                className="brand-mark"
                src="/brand/mascot-idle.png"
                alt=""
                aria-hidden="true"
                width={397}
                height={583}
              />
              <span className="sr-only">Changuito</span>
            </a>
          </header>
          <HumanGate siteKey={siteKey}>
            <Purchases />
          </HumanGate>
        </main>
      </WalletProvider>
    </NetworkProvider>
  );
}
