# changuito — documentation

changuito is a chat app where an agent shops Argentine supermarkets over MCP and
settles the basket in USDC on Stellar testnet.

| Document | What is in it |
|---|---|
| [architecture.md](architecture.md) | the system diagram, what each process is, and where the trust boundaries fall |
| [flows.md](flows.md) | the five paths that matter, end to end: a chat turn, funding, payment, settlement, refund |
| [stellar.md](stellar.md) | every Stellar technology used, and what each one is doing here |
| [tech-stack.md](tech-stack.md) | the dependency list with versions, and why each one is there |

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
  user confirms  ──►  escrow.open()   USDC: buyer ──► contract
        │                              the basket is hashed into the order
        ▼
  user completes the basket at the store
        │
        ├── done      ──►  escrow.settle()   USDC: contract ──► treasury
        └── not done  ──►  escrow.refund()   USDC: contract ──► buyer
```

Everything is testnet, and the USDC is a demo token this repo deploys and mints.
Nothing here moves real money.
