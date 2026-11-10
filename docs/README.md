# changuito — documentation

changuito is a chat app where an agent shops Argentine supermarkets over MCP,
takes the exact store total in USDC on Stellar, and hands back a card the
shopper pays the súper with.

**Reviewing this for a hackathon? Start at [judges.md](judges.md).**

| Document | What is in it |
|---|---|
| [judges.md](judges.md) | fifteen minutes in order, every claim mapped to the file that backs it, and what is real versus simulated |
| [architecture.md](architecture.md) | the system diagram, the cross-origin wall, the money rail, and where the trust boundaries fall |
| [flows.md](flows.md) | the paths that matter, end to end: a chat turn, funding, the deposit rail, and the escrow checkout |
| [stellar.md](stellar.md) | every Stellar technology used, and what each one is doing here |
| [tech-stack.md](tech-stack.md) | the dependency list with versions, the data stores, and every environment variable |
| [e2e.md](e2e.md) | Playwright smoke against the live sites, and the GitHub Actions secrets |

Elsewhere in the repo:

- [`../README.md`](../README.md) — what changuito is, the deployed contract ids,
  and what was verified on testnet.
- [`../DEPLOY.md`](../DEPLOY.md) — deploying the contracts, then the app on Vercel.
- [`../CLAUDE.md`](../CLAUDE.md) — how the agent's behaviour was arrived at, and
  which decisions not to undo.
- [`../packages/mcp/VENDORED.md`](../packages/mcp/VENDORED.md) — what changed in
  the MCP server on the way into this repo.

## The shortest possible summary

```
  "armá un desayuno por menos de $10.000"
        │
        ▼
  agent searches Día over MCP, builds a real cart, hands back a real cart link
        │
        ▼
  the store's own checkout opens in a frame; the shopper logs in and
  picks a delivery slot
        │
        ▼
  the server reads the *payable* total from the store's public cart
  — items + envío − descuentos — and quotes it
        │
        ▼
  one press: USDC ──► deposit account, with a código in the memo
        │
        ▼
  Horizon confirms the payment landed. Nothing else is asked.
        │
        ▼
  a card is shown, with that importe. The shopper pays the súper with it.
```

Two networks, one path. Signed out is **modo prueba** on testnet, paid from a
demo wallet this repo holds. Signed in with Pollar is **modo real** on mainnet,
paid from the shopper's own account.

The escrow contract is deployed on testnet over the Circle USDC SAC. On the
login network it is the checkout path — [stellar.md](stellar.md#the-escrow-contract).
Other networks still use the memo deposit.
