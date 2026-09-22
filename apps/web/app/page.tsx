import { Chat } from '../components/Chat';
import { WalletProvider } from '../components/WalletProvider';
import { WalletWidget } from '../components/WalletWidget';

export default function Home() {
  return (
    <WalletProvider>
      <main className="shell">
        <header className="masthead">
          <div>
            <h1>changuito</h1>
            <p className="tagline">Supermercado por MCP, pago en USDC sobre Stellar.</p>
          </div>
          <WalletWidget />
        </header>
        <Chat />
      </main>
    </WalletProvider>
  );
}
