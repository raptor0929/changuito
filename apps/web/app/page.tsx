export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 16px' }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>changuito</h1>
      <p style={{ color: 'var(--muted)', fontSize: 18, lineHeight: 1.6 }}>
        An agent that shops Argentine supermarkets over MCP and settles the basket in USDC on
        Stellar testnet.
      </p>
    </main>
  );
}
