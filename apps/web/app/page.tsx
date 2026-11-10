import { PUBLIC_LEGAL } from '@changuito/trust';

import { BetaOnboarding } from '../components/BetaOnboarding';
import { Chat } from '../components/Chat';
import { Deck } from '../components/Deck';
import { HumanGate } from '../components/HumanGate';
import { LangProvider } from '../components/LangProvider';
import { LangToggle } from '../components/LangToggle';
import { NetworkProvider } from '../components/NetworkProvider';
import { ShopProvider } from '../components/ShopProvider';
import { TopBar } from '../components/TopBar';
import { WalletProvider } from '../components/WalletProvider';
import { COPYRIGHT_LINE } from '../lib/founder-trust-copy';
import { turnstileSiteKey } from '../lib/human-gate';
import { inLang } from '../lib/lang.ts';
import { langFromCookie } from '../lib/lang-server.ts';
// The site key has to be read per request. A static prerender baked siteKey:""
// and the widget never appeared, even after the env var existed at runtime.
export const dynamic = 'force-dynamic';

export default async function Home() {
  // Runtime read, not the client bundle. The widget key is public.
  const siteKey = turnstileSiteKey();
  // Read here rather than in a provider effect so the first HTML is already in
  // the shopper's language. See components/LangProvider.tsx.
  const lang = await langFromCookie();
  return (
    // Outermost, above the network: every provider below draws words, and the
    // mode copy is one of the things that gets translated.
    <LangProvider initial={lang}>
      {/* Outside the wallet on purpose: the mode decides which chain and
          which key that provider is built with, so it has to be decided
          above it. */}
      <NetworkProvider>
        <WalletProvider>
          <ShopProvider>
            {/* Above the deck and outside it: the bar spans the window at
                every width, including the three-column one. */}
            <TopBar />
            <Deck>
              <main className="shell">
                {/* The wordmark and the wallet moved up into the bar; what is
                    left here is the one sentence that says what this is. */}
                <header className="masthead">
                  {/* Rendered on the server, so LangToggle reaches it through
                      router.refresh() and not through the context. See that
                      component. */}
                  <p className="tagline">
                    {inLang(lang, {
                      es: 'Contale a Changuito lo que necesitás y dejá que se encargue de planear todo.',
                      en: 'Tell Changuito what you need and let it take care of the planning.',
                    })}
                  </p>
                </header>
                <BetaOnboarding />
                <HumanGate siteKey={siteKey}>
                  <Chat />
                </HumanGate>
                <footer className="app-footer" data-testid="app-footer">
                  <span className="app-footer-copy">{COPYRIGHT_LINE}</span>
                  <a className="app-legal" href="/privacidad">
                    {inLang(lang, { es: 'Privacidad', en: 'Privacy' })}
                  </a>
                  <a className="app-legal" href={inLang(lang, PUBLIC_LEGAL.terms)}>
                    {inLang(lang, { es: 'Términos', en: 'Terms' })}
                  </a>
                  <a className="app-legal" href={inLang(lang, PUBLIC_LEGAL.deletion)}>
                    {inLang(lang, { es: 'Eliminar cuenta', en: 'Delete account' })}
                  </a>
                  <LangToggle />
                </footer>
              </main>
            </Deck>
          </ShopProvider>
        </WalletProvider>
      </NetworkProvider>
    </LangProvider>
  );
}
