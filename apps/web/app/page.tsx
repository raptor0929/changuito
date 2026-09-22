import { Chat } from '../components/Chat';
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
            <div>
              <h1>Changuito</h1>
              <p className="tagline">Supermercado por MCP, pago en USDC sobre Stellar.</p>
            </div>
          </div>
          <WalletWidget />
        </header>
        <Chat />
      </main>
    </WalletProvider>
  );
}
