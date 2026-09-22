import { Chat } from '../components/Chat';
import { HumanGate } from '../components/HumanGate';
import { WalletProvider } from '../components/WalletProvider';
import { WalletWidget } from '../components/WalletWidget';

export default function Home() {
  return (
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
              <h1 className="brand-name">Changuito</h1>
              <p className="tagline">
                Contale a Changuito lo que necesitás y dejá que se encargue de planear todo.
              </p>
            </div>
          </div>
          <WalletWidget />
        </header>
        <HumanGate>
          <Chat />
        </HumanGate>
        <p className="report-bug">
          <a
            href="https://www.changuito.me/reportarbug"
            target="_blank"
            rel="noopener noreferrer"
          >
            Reportar un bug
          </a>
        </p>
      </main>
    </WalletProvider>
  );
}
