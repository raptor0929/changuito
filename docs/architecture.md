# Architecture

## Overview

changuito is three things that happen to live in one repository:

1. **An MCP server** (`packages/mcp`) that speaks to four Argentine VTEX
   supermarkets — search, price check, cart building, and a link that opens that
   exact cart on the store's own site. It was written first, as a standalone
   server for chat clients.
2. **An agent** (`apps/web/lib/agent`) that drives it. A streaming Anthropic
   tool loop with the MCP server's tools on one side and a handful of
   display-only tools on the other.
3. **A Soroban escrow** (`contracts/escrow`) that holds the USDC between "the
   user approved this basket" and "the basket actually happened".

The app is the reason the other two exist: the MCP server had never been used by
anything except a chat client, and this proves it works inside a product.

## System diagram

```
┌─ BROWSER ────────────────────────────────────────────────────────────────┐
│                                                                          │
│  PollarProvider  ──  login, the wallet address, and the signature on     │
│    │                 escrow.open()                                       │
│    │                                                                     │
│  WalletWidget  ── balance + [Fund]        (masthead, always visible)     │
│  Chat          ── transcript, product grids, cart cards                  │
│  PaymentModal  ── ARS → USDC quote, then runTx('invoke_contract')        │
│  OrderPanel    ── after open: "ya compré" / "no pude", tx links          │
│                                                                          │
│  chat-state.ts ── a pure reducer over UiEvents. No framework, testable.  │
└──────────┬───────────────────────────────────────────────────────────────┘
           │  POST /api/chat  (SSE)          other routes: plain JSON
           ▼
┌─ NEXT.JS ON VERCEL — Node runtime, never edge ───────────────────────────┐
│                                                                          │
│  /api/chat     the agent loop, streamed as Server-Sent Events            │
│    │                                                                     │
│    ├─ Anthropic Messages API (streaming, tools, prompt caching)          │
│    │    ▲                                                                │
│    │    └── fallback, per hop, whenever the local model cannot answer    │
│    ├─ a local model, optional — OpenAI-compatible, over a tunnel         │
│    │                                                                     │
│    └─ MCP Client ──InMemoryTransport──► McpServer ──HTTPS──► Día's VTEX  │
│                     (real tools/list and tools/call, no subprocess)      │
│                                                                          │
│  /api/balance  XLM (Horizon) + demo USDC (contract read)                 │
│  /api/faucet   friendbot if unfunded, then mint — resolver signs         │
│  /api/quote    ARS → USDC at the live rate, or a pinned one              │
│  /api/settle   escrow.settle / escrow.refund — resolver signs            │
│                                                                          │
│  state:  MCP session   → warm Map + a snapshot the BROWSER holds         │
│          chat history  → Upstash Redis, 1h TTL (in-memory fallback)      │
│          model health  → Upstash Redis: breaker + one lane               │
└──────────┬───────────────────────────────────────────────────────────────┘
           │  Soroban RPC / Horizon
           ▼
┌─ STELLAR TESTNET ────────────────────────────────────────────────────────┐
│                                                                          │
│  escrow     CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557     │
│               open / settle / refund / get_order / config                │
│  demo USDC  CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF     │
│               SEP-41, 7 decimals, admin-gated mint                       │
│                                                                          │
│  resolver   GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK     │
│               token admin AND escrow resolver — one hot key, not two     │
│  treasury   GAXUICH5DZMB4ZIZVF6ETTE524RCZYRKHWLGG7EOLY6ECVD4IS6TBNZG     │
│               where a settled basket's USDC lands                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## The pieces, and why they are shaped that way

### The MCP server runs in-process, over a real transport

`lib/mcp/boot.ts` creates an MCP `Client` and an `McpServer` and links them with
`InMemoryTransport.createLinkedPair()`. That is the actual protocol —
`initialize`, `tools/list`, `tools/call` — with a pair of queues instead of a
pipe.

Importing the tool functions and calling them directly would be shorter, and
would defeat the purpose: the point of this app is to demonstrate what the MCP
server does, so the protocol has to be on the wire.

Spawning the published binary as a subprocess would also be real MCP, but the
binary registers the checkout tools, which open a **headed browser on the server
host** so a human can type their supermarket password. That cannot run on
Vercel. `@changuito/mcp/server` is the half that can, and it has no path to the
checkout module at all — the checkout tools sit behind a dynamic `import()`, so
nothing in the web app's import graph can even resolve Playwright.

The ten tools the agent sees: `list_retailers`, `set_location`,
`search_products`, `get_product`, `price_check`, `add_to_cart`,
`update_cart_item`, `view_cart`, `get_cart_link`, `where_am_i`.

### Two kinds of tool, and the split is the design

The MCP tools answer *what the data is*. A second set —
`apps/web/lib/agent/render-tools.ts` — answers *what to show*, never leaves the
process, and emits a UI event instead of calling anything.

The reason is that a search result is not a recommendation. `search_products`
returns twelve items whether the model recommends three of them or none, so
*which ones to surface* is a decision, and a decision has to be a call.

**Render tools take identifiers only** — never a price, never a name. The model
picks SKUs; the server looks up what they cost in a per-conversation cache. A
hallucinated price has no argument to travel in. That matters most directly
above a button that spends money.

### Two kinds of state, stored in opposite places

| State | Lives in | Because |
|---|---|---|
| MCP session (postal code, sales channel, cart id) | a **snapshot the browser holds** and sends back each turn, plus a warm `Map` for speed | it is small, it is stable, and there is nothing in it the user does not already have — the cart id is handed to them as a URL |
| Conversation history (messages, product cache) | **Upstash Redis**, keyed by session, 1h TTL | it is the conversation itself and grows every hop, so it cannot ride in a request body |
| Local-model health (circuit breaker, lane lease) | **Upstash Redis**, one key each | it is about the *fleet*, not a session. Per-instance, every cold lambda would rediscover a sleeping machine by paying the full timeout — and the visitor pays it too |

Both exist because a Vercel lambda's module scope is a cache, not a database:
instances are recycled on deploy, on idle and on scale-out, and two messages
from the same user can land on different ones. With no Redis configured the
history falls back to an in-process `Map`, which on one developer's machine is
the same guarantee for free.

A **refresh is a fresh start, by design**. The session id is minted with
`crypto.randomUUID()` into a `useRef` and nothing persists it. See
[`../CLAUDE.md`](../CLAUDE.md) for why the half-measure is worse than either end
state.

### Everything Stellar is server-side except the signature

`@stellar/stellar-sdk` never enters the client bundle. The browser reads
balances through `/api/balance` and prices a basket through `/api/quote`. The
one thing it does itself is sign `escrow.open` — through Pollar, in the user's
own wallet, because that signature *is* the authorization to move their money.

## Trust boundaries

```
   user's wallet  │  the app's backend  │  the chain
   ───────────────┼─────────────────────┼──────────────────────────────
   signs open()   │  signs settle()     │  enforces both
                  │  signs refund()     │  enforces basket_hash
                  │  signs mint()       │  enforces the deadline
```

Three properties the contract enforces regardless of what the backend does:

1. **The buyer's money only moves out of their balance with their signature.**
   `open` calls `buyer.require_auth()`, and that same signature covers the
   `transfer` underneath it.
2. **The basket is committed.** `settle` takes the `basket_hash` and rejects a
   mismatch with `BasketMismatch`. The backend cannot settle against a different
   basket than the one the user approved.
3. **The buyer can always get out.** After the deadline the buyer can call
   `refund` themselves, without the resolver's cooperation, and the event
   records `self_service: true` — which in an audit means the backend never came
   back.

The backend holds **one hot key**, `changuito-resolver`, which is both the token
admin (so the faucet can mint) and the escrow resolver (so it can settle and
refund). One key rather than two, because a demo with two hot keys is two keys
to leak. It is read from `STELLAR_RESOLVER_SECRET` at call time rather than at
import time, so a build without it still succeeds and only the routes that
actually sign fail.

**Where this is honest about its limits:** the resolver settles on the user's
word that they completed the basket, because changuito's read-only MCP path
stops at the cart link. In a real deployment the resolver would confirm with the
store itself. It is fine here because the money is test USDC and the only
account that can be hurt is the caller's own.

## Repository layout

```
changuito/
├── apps/web/                Next.js shopper — the agent, the UI, the API routes
│   ├── app/api/             chat (SSE), balance, faucet, quote, settle
│   ├── components/          Chat, ProductGrid, CartCard, PaymentModal,
│   │                          OrderPanel, WalletWidget, WalletProvider
│   └── lib/
│       ├── agent/           loop, prompt, render-tools, turn-store,
│       │                     provider + providers/ (wire, gate, the two models)
│       ├── mcp/             boot (in-memory transport), bridge, session
│       ├── chat-state.ts    the transcript reducer
│       ├── order.ts         basket → the five args escrow.open takes
│       ├── stellar.ts       RPC, friendbot, unit maths, explorer links
│       └── server/          the resolver key — server-only
├── apps/landing/            marketing site for www.changuito.me (no shopper routes)
├── apps/branding/           brand kit, sibling of the two apps (not a workspace package)
├── contracts/
│   ├── escrow/              open, settle, refund, events — 19 tests
│   └── mock_usdc/           SEP-41 token, admin-gated mint
├── packages/
│   ├── mcp/                 the vendored MCP server — 520 tests
│   ├── escrow-bindings/     generated from the deployed wasm
│   └── usdc-bindings/       generated from the deployed wasm
├── scripts/deploy-testnet.sh
└── deployments.json         contract ids and accounts, written by the script
```
