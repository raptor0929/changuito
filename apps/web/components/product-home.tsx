import { Chat } from './Chat';
import { WalletProvider } from './WalletProvider';
import { WalletWidget } from './WalletWidget';

/**
 * The shopper that used to live at `/`.
 * The marketing host serves the landing there. `app.changuito.me` rewrites
 * `/` to `/agent`, which renders this same screen.
 */
export function ProductHome() {
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
