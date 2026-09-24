# Stellar technologies

Everything on this list is testnet, and every piece is doing real work — there
is no component here whose removal would leave the app functioning.

| Technology | Where it is used |
|---|---|
| **Soroban smart contracts** (Rust, `soroban-sdk` 25.3.2) | the escrow and the demo USDC token |
| **SEP-41 token interface** | `contracts/mock_usdc` implements it; the escrow calls the standard `transfer` through `token::TokenClient` |
| **Soroban authorization** (`require_auth`) | the buyer authorizes `open`; the resolver authorizes `settle` and `refund` |
| **Contract constructors** (`__constructor`) | both contracts are configured at deploy — no separate `initialize` call anyone could front-run |
| **Contract events** (`#[contractevent]`) | `Opened`, `Settled`, `Refunded` on the escrow; `Transfer`, `Mint`, `Burn`, `Approve`, `SetAdmin` on the token |
| **Persistent storage + TTL extension** | one entry per order, plus instance TTL bumped on every write |
| **Soroban RPC** (`soroban-testnet.stellar.org`) | simulating and submitting every contract call, and reading balances |
| **Horizon** (`horizon-testnet.stellar.org`) | the one thing RPC does not answer: a classic XLM balance |
| **Friendbot** | creating and funding accounts so their first transaction can pay a fee |
| **`stellar contract bindings typescript`** | `packages/escrow-bindings` and `packages/usdc-bindings`, generated from the deployed wasm |
| **`@stellar/stellar-sdk` 17.1.0** | `rpc.Server`, `Horizon.Server`, `StrKey`, `Keypair`, `basicNodeSigner` — server-side only |
| **Pollar** (`@pollar/react` 0.11.3) | the wallet: login, the address, and `runTx('invoke_contract', …)` for `escrow.open` |
| **stellar.expert** | the explorer links shown after every transaction |

---

## The escrow contract

`CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557`

```rust
open(buyer, order_id: BytesN<32>, amount: i128,
     basket_hash: BytesN<32>, timeout_secs: u64) -> Order
settle(order_id, basket_hash, receipt_hash) -> Order
refund(caller, order_id) -> Order
get_order(order_id) -> Order          // panics if unknown
find_order(order_id) -> Option<Order> // does not
config() -> Config                    // resolver, treasury, token
```

Configured at deploy with three addresses — resolver, treasury, and the SEP-41
token it holds — and **the token is fixed there**, so an escrow cannot be
convinced to settle in something else.

### Why an escrow and not a transfer

The flow has a real gap in it. The agent takes the money when the user confirms,
but the groceries are not secured until the basket actually clears the store,
and between those two moments the price can move, stock can vanish, or the store
can reject the basket. Something has to hold the money across that gap and be
able to give it back.

Three properties a plain transfer does not have:

1. **The money is recoverable** — a failed basket refunds without anyone's
   goodwill, and after the deadline without anyone's cooperation.
2. **The basket is committed** — `settle` rejects a `basket_hash` that is not
   the one the buyer approved, with `BasketMismatch`.
3. **The receipt is verifiable** — `settle` stores a hash of the handoff,
   `get_order` reads it back, and both transitions emit events, so
   stellar.expert is a real audit trail.

### Authorization, exactly

- `open` calls `buyer.require_auth()`. That same signature also covers the
  `transfer` out of the buyer's balance underneath it — one approval, not two.
- `settle` calls `cfg.resolver.require_auth()`. The buyer cannot move money out
  of an escrow they funded; only the resolver can release it, and only to the
  treasury address fixed at deploy.
- `refund` takes `caller` **explicitly**, because the two cases authorize
  different addresses and `require_auth` has to be called on the one that
  actually signed. The resolver may refund at any time. The buyer may refund
  only after `deadline`. Nobody else, ever — a stranger is rejected with
  `NotAuthorized` even after the deadline has passed.

### Bounds and invariants

| Rule | Error |
|---|---|
| `amount > 0` | `InvalidAmount` |
| `300s ≤ timeout_secs ≤ 30 days` | `InvalidTimeout` |
| an `order_id` is never reused | `OrderExists` |
| an order can only be closed once | `OrderClosed` |
| `settle` must present the approved basket | `BasketMismatch` |
| neither resolver, nor buyer after the deadline | `NotAuthorized` |

The timeout has a floor because a deadline that has already passed is an instant
self-refund, and a ceiling because one far enough out means the money is
effectively gone.

**Status is written before the transfer**, in both `settle` and `refund`: a
token whose `transfer` re-enters this contract must find the order already
closed.

19 tests in `contracts/escrow/src/test.rs`, with snapshots. They cover both
happy paths with balances reconciled exactly, every rejection above, that a
rejected call leaves no event behind, and that a refunded order cannot then be
settled.

---

## The demo USDC token

`CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF` — SEP-41, symbol
`USDC`, 7 decimals, admin-gated `mint`.

**Why not Blend's testnet mock.** It is a real SEP-41 token, but a probe during
planning showed its admin is `GATALTGT…5V56`, an address we do not control, and
there is no faucet for it. A demo could not hand anyone a balance.
`contracts/mock_usdc` is the same interface, same symbol, same decimals, with
our resolver as admin. The UI says *"USDC de prueba"* rather than implying
Blend.

`mint` is admin-gated rather than permissionless so a public demo cannot be
drained.

### It has no issuer, and needs no trustline

This is a Soroban contract, not a classic Stellar asset. There is no
`CODE:ISSUER` pair and nothing to `changeTrust` to — balances live in the
contract's own storage, so a mint to an address that has never existed just
works. Verified: a freshly generated address with no account at all went from
`0` to `50.00` through one `POST /api/faucet`.

That is deliberate. A classic asset cannot reach an account without a trustline,
so every visitor would have to sign a `changeTrust` before the faucet could give
them anything, and "press Fund, get USDC" is the point of the widget.

It follows that Pollar's `setTrustline({ code, issuer })` does not apply, and
Pollar's balance endpoints — Horizon-backed, classic assets only — will not list
this token. That is why `/api/balance` reads the contract directly.

---

## Accounts

| Role | Address | Does |
|---|---|---|
| resolver | `GBGMPRHU…HTFK` | token admin (the faucet mints) **and** escrow resolver (settles, refunds) |
| treasury | `GAXUICH5…BNZG` | where a settled basket's USDC lands |

One hot key, not two, because a demo with two hot keys is two keys to leak. It
is read from `STELLAR_RESOLVER_SECRET` **at call time**, never at import time —
so a build without the variable still succeeds and only the routes that actually
sign fail. The loader also checks the key's public address against
`deployments.json` and refuses a mismatch, which turns "the contract silently
rejects everything" into one clear error.

---

## RPC, Horizon, and friendbot

**Soroban RPC** does nearly everything: simulate, submit, and read contract
state. `/api/balance` calls the token contract directly rather than asking a
wallet API, because the wallet API only knows about classic assets.

**Horizon** is used for exactly one thing — a classic XLM balance — because that
is not contract state. A smart wallet has no Horizon account at all, so `xlm`
comes back `null` for one and the UI does not pretend otherwise.

**Friendbot** runs before any mint. Below `MIN_XLM = 5` the faucet goes back to
it. Existing-and-non-empty is not the test: Pollar creates its wallets with a
sponsored `createAccount` at a starting balance that cannot pay for much, and an
address nobody topped up signs transactions that fail with
`tx_no_source_account` — which reads like a bug in the app rather than an empty
wallet.

---

## Bindings, and the version pin

`scripts/deploy.sh` builds for `wasm32v1-none`, deploys both contracts,
writes `deployments.json`, then runs `stellar contract bindings typescript`
against the **deployed** contract ids into `packages/escrow-bindings` and
`packages/usdc-bindings`. So the TypeScript the app compiles against is
generated from the wasm actually on the ledger, not from the source next to it.

`soroban-sdk` is pinned to **25.3.2** to match the local `stellar` CLI
(**25.1.0**, while 28.0.0 is current). A contract built by a newer SDK than the
CLI that deploys it is a confusing class of build error, and the protocol
accepts an older env meta version than the ledger's anyway. If you upgrade the
CLI, move the pin with it.

Node must be **≥ 22.12** — `@stellar/stellar-sdk@17` requires it, and on Vercel
the project's Node version has to be set explicitly or the install fails.
