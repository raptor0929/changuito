# Basic flows

Five paths, in the order a user meets them. Every one of them has been run on
testnet.

---

## 1. A chat turn

The only streaming path in the app. One user message in, an arbitrary number of
tool calls, and a transcript that has to stay readable while it is being built.

```
BROWSER                       /api/chat                     MCP        ANTHROPIC
   │
   │ POST { sessionId, message, snapshot? }
   ├──────────────────────────►│
   │                           │ withSession(id, snapshot)
   │                           │   warm Map hit, or boot a new
   │                           │   MCP pair and restore(snapshot)
   │                           │
   │                           │ turns.get(sessionId)  ◄── Redis
   │                           │
   │                           │ ┌─ hop 0..11 ────────────────────────────┐
   │                           │ │ messages.stream(model, tools, system)  │
   │                           │ │                          ──────────────►
   │   ◄── text / thinking ────│ │  ◄── deltas ───────────────────────────│
   │                           │ │                                        │
   │                           │ │ for each tool_use:                     │
   │   ◄── tool_start ─────────│ │   MCP tool ──► tools/call ──► VTEX     │
   │   ◄── products / cart ────│ │   render tool ──► emit, no I/O         │
   │   ◄── tool_end ───────────│ │                                        │
   │                           │ │ no tool calls → done                   │
   │                           │ └────────────────────────────────────────┘
   │                           │
   │                           │ turns.set(sessionId, turn)  ──► Redis
   │   ◄── done { snapshot } ──│
   │
   │ keeps the snapshot, sends it back next turn
```

Details worth knowing:

- **Transport is SSE**, with a `:` heartbeat every 15s. A single search against
  a slow storefront can go twenty seconds without a byte, and an idle stream is
  a stream a proxy feels free to close. `X-Accel-Buffering: no` stops a proxy
  buffering the whole thing into one delivery at the end.
- **`MAX_HOPS = 12`.** Past that the model is stuck, not working, and the user
  gets a plain message saying so.
- **Render tools are not traced.** `tool_start`/`tool_end` fire for MCP tools
  only — those reach a supermarket and explain a wait. A render tool moves data
  the user is already looking at.
- **History is written only after a clean return.** A turn that threw mid-hop
  can leave an assistant `tool_use` with no matching `tool_result`, and the API
  rejects that pairing on the *next* request — so the failure would surface one
  message later, on a turn that did nothing wrong.
- **The transcript is a reducer.** `chat-state.ts` folds `UiEvent`s into blocks.
  The hard part is ordering: a grid arrives mid-sentence, and appending it at
  the end of the turn would make the sentence introducing it read as its
  caption.

### What the user sees

```
1. GREETING   what the agent can do, and three starter prompts
2. RESEARCH   "buscando leche…", tool trail, then a product grid
3. RESULTS    the recommended items, a cart card, and the real Día link
4. CONFIRM    [Confirmar y pagar] — quote in ARS and USDC, wallet balance
5. ON-CHAIN   Pollar signs escrow.open  →  tx hash
6. DONE       settle or refund, both explorer links, the store link to finish
```

---

## 2. Funding a wallet

Two steps, and the order is the point.

```
[Fondear]  ──►  POST /api/faucet { address }
                   │
                   │ 1. friendbot, if XLM < 5
                   │      an address nobody funded is just a public key: every
                   │      transaction it signs fails with tx_no_source_account,
                   │      which reads like a bug in the app rather than an
                   │      empty wallet
                   │
                   │ 2. usdc.mint(to, 50.0000000)   ── resolver signs, it is
                   │      the token admin
                   │
                   ▼
                { xlm, usdc, usdcDisplay, txHash, created }
                   │
                   ▼
                useBalances().refresh()
```

Doing it the other way round hands someone money they cannot spend.

- Grant is **50 demo USDC**; the route short-circuits above **100** held, with a
  **60s per-address cooldown**. The cooldown is in memory on purpose — it exists
  to stop a stuck button making one hot key sign fifty transactions, not to stop
  a determined adversary.
- **Smart wallets have no Horizon account**, so `xlm` comes back `null` for
  them and only the mint runs.
- The demo token is a **SEP-41 contract, not a classic asset**: there is no
  `CODE:ISSUER` and nothing to `changeTrust` to, so a mint to an address that
  has never existed just works. That is why the faucet can be one button.

---

## 3. Payment — opening the escrow

The only thing the browser signs.

```
BROWSER                                  /api/quote            STELLAR
   │
   │ PaymentModal opens with the cart
   ├─ GET /api/quote?centavos=… ────────────►│
   │   ◄── { arsPerUsd, usdCents, units, display }
   │
   │ orderId    = crypto.getRandomValues(32)      random, NOT derived
   │ basketHash = sha256(canonicalBasket(cart))   32 bytes
   │
   │ runTx('invoke_contract', {
   │   contractId: escrow,
   │   method: 'open',
   │   args: [buyer, order_id, amount, basket_hash, timeout_secs]
   │ })
   ├─ Pollar: user approves in their wallet ─────────────────────►│
   │                                                              │
   │                                         escrow.open:         │
   │                                           buyer.require_auth()
   │                                           amount > 0
   │                                           300s ≤ timeout ≤ 30d
   │                                           order_id unseen
   │                                           USDC: buyer ──► contract
   │                                           emit Opened{…}
   │   ◄── { status, hash } ──────────────────────────────────────│
   │
   │ keep { orderId, basketHash, amountUnits, hash, cartId, handoffUrl }
   │ show OrderPanel
```

- **`basket_hash` is what makes this more than a transfer.** It commits to the
  exact items, quantities, per-line and total pesos, and which lines the store
  said were unavailable — as a versioned, line-oriented text, not
  `JSON.stringify`, because a hash is a promise about bytes and object key order
  is an implementation detail of whoever built the object.
- The **USDC amount is deliberately not in the hash**: the contract stores it as
  its own field, so hashing it too would be a second copy that can disagree.
- **`order_id` is random, not derived from the basket.** `open` rejects an id it
  has seen, which is what stops a double submit — but a deliberate second
  attempt at the same basket (the first failed in the wallet) must be a new
  order, or it would be rejected for the wrong reason.
- **Arguments are positional** and `order.test.ts` reads the signature out of
  `lib.rs` to check them, because two swapped `BytesN<32>` arguments type-check,
  deploy, and then settle the wrong basket.
- `timeout_secs` defaults to **3600** — long enough that a slow pickup does not
  strand the money, short enough that a user who walks away can self-refund the
  same afternoon.

---

## 4. Settlement — the basket happened

```
OrderPanel: "ya compré"  ──►  POST /api/settle
                                 { orderId, basketHash, action: 'settle',
                                   retailer, cartId, handoffUrl }
                                    │
                                    │ settledAt   = new Date().toISOString()
                                    │ receiptHash = sha256(canonicalReceipt(…))
                                    │
                                    │ escrow.settle(order_id, basket_hash,
                                    │               receipt_hash)
                                    │   resolver.require_auth()
                                    │   status must be Open
                                    │   basket_hash must match  ── else
                                    │                              BasketMismatch
                                    │   status ← Settled, receipt stored
                                    │   USDC: contract ──► treasury
                                    │   emit Settled{…}
                                    ▼
                              { hash, txUrl, amountDisplay, receipt, receiptHash }
```

The status is written **before** the transfer: a token whose `transfer`
re-enters the contract must find the order already closed.

The receipt hashes the handoff — retailer, cart id, the link the user was given,
and when the resolver released the money. In a full product it would hash the
store's own order number, which is the thing an auditor could take back to Día;
the shape does not change when one arrives. The route returns the exact text the
hash was taken over, so anyone can re-derive it.

---

## 5. Refund — it did not

```
OrderPanel: "no pude"  ──►  POST /api/settle { orderId, action: 'refund' }
                               │
                               │ escrow.refund(caller = resolver, order_id)
                               ▼
                            USDC: contract ──► buyer
                            emit Refunded{ self_service: false }
```

And the path that does not need the app at all:

```
after the deadline, buyer calls refund(caller = buyer, order_id) directly
                               ▼
                            USDC: contract ──► buyer
                            emit Refunded{ self_service: true }
```

`refund` takes `caller` explicitly because the two cases authorize different
addresses, and `require_auth` has to be called on the one that actually signed.
Before the deadline only the resolver can refund; after it, the buyer can too,
and nobody else ever can — a stranger is rejected with `NotAuthorized` even once
the deadline has passed.

The `self_service` flag on the event is worth distinguishing in an audit: it
means the backend never came back. That path is what stops this from being a
trust-me custodial box.

---

## State transitions

```
                   open()
        (none) ──────────────► Open
                                │ │
                settle() ───────┘ └─────── refund()
                   │                          │
                   ▼                          ▼
                Settled                    Refunded
```

Terminal in both directions: an order can only be closed once, and a refunded
order cannot then be settled. Both are covered by the escrow's 19 tests, which
also reconcile balances exactly across `open → settle` and `open → refund`, and
assert that a rejected call leaves no event behind.
