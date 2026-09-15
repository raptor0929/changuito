import { Chat } from '../components/Chat';

export default function Home() {
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <h1>changuito</h1>
          <p className="tagline">Supermercado por MCP, pago en USDC sobre Stellar.</p>
        </div>
        {/* The wallet balance widget lands here. */}
      </header>
      <Chat />
    </main>
  );
}
