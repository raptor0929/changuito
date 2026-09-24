import { Chat } from '../components/Chat';
import { FooterSocial } from '../components/FooterSocial';
import { FounderTrust } from '../components/FounderTrust';
import { HumanGate } from '../components/HumanGate';
import { NetworkProvider } from '../components/NetworkProvider';
import { WalletProvider } from '../components/WalletProvider';
import { WalletWidget } from '../components/WalletWidget';
import { turnstileSiteKey } from '../lib/human-gate';

// The site key has to be read per request. A static prerender baked siteKey:""
// and the widget never appeared, even after the env var existed at runtime.
export const dynamic = 'force-dynamic';

export default function Home() {
  // Runtime read, not the client bundle. The widget key is public.
  const siteKey = turnstileSiteKey();
  return (
    // Outside the wallet on purpose: the mode decides which chain and which
    // key that provider is built with, so it has to be decided above it.
    <NetworkProvider>
      <WalletProvider>
        <main className="shell">
          <header className="masthead">
            <div className="brand">
              <img
                className="brand-mark"
                src="/brand/mascot-idle.png"
                alt=""
                aria-hidden="true"
                width={397}
                height={583}
              />
              <div className="brand-copy">
                {/* The name is text, not only an alt: tools that read a
                    heading's text content (crawlers, some audits) saw an
                    empty h1. The image is then decorative, so it is not read
                    twice. */}
                <h1 className="brand-name">
                  <span className="sr-only">Changuito</span>
                  <img
                    className="brand-wordmark"
                    src="/brand/wordmark.png"
                    alt=""
                    aria-hidden="true"
                    width={1097}
                    height={249}
                  />
                </h1>
                <p className="tagline">
                  Contale a Changuito lo que necesitás y dejá que se encargue de planear todo.
                </p>
              </div>
            </div>
            <WalletWidget />
          </header>
          <HumanGate siteKey={siteKey}>
            <Chat />
          </HumanGate>
          <footer className="app-footer">
            <FounderTrust />
            <FooterSocial />
          </footer>
        </main>
      </WalletProvider>
    </NetworkProvider>
  );
}
