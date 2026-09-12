# Setup

Installing, configuring and operating `supermercado-mcp`: an MCP server that searches
Argentine supermarket catalogs, builds a cart inside **your own logged-in session**, and
pays for it with a single-use virtual card funded from crypto.

Read section 12 before section 10. The rest is in the order you'll need it. For how the
system is built and why, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).

> **What this spends.** Sections 1–9 spend nothing: every step is either local or a read-only
> API call, and the dry run in section 9 stops one step before a card exists. Section 10 is
> the first one that moves money, and it needs `ALLOW_LIVE=1` plus an exact amount typed back
> by you.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Install and build](#2-install-and-build)
3. [Registering the MCP server in your client](#3-registering-the-mcp-server-in-your-client)
4. [Vyrion: account, API key, sandbox vs live, choosing a BIN](#4-vyrion-account-api-key-sandbox-vs-live-choosing-a-bin)
5. [Crypto wallet: keystore, funding, asset](#5-crypto-wallet-keystore-funding-asset)
6. [TypeSafe / Jev API key (and running without it)](#6-typesafe--jev-api-key-and-running-without-it)
7. [Linking your Día account](#7-linking-your-día-account)
8. [Configuration reference](#8-configuration-reference)
9. [Running a dry run](#9-running-a-dry-run)
10. [Running a real purchase](#10-running-a-real-purchase)
11. [Troubleshooting](#11-troubleshooting)
12. [Security model](#12-security-model)

---

## 1. Prerequisites

| | Why |
|---|---|
| **Node 20 or newer** | Native `fetch`, `node:test`, and top-level `await` in ES modules. Check with `node -v`. |
| **Chromium for Playwright** | The checkout is browser-driven. `npx playwright install chromium` (~150 MB). |
| **An MCP client** | Claude Code, Claude Desktop, or anything that speaks MCP over stdio. |
| **A Día account** | Created by you, in a browser, before anything here runs. DNI is required at signup, which is why this system never asks you for one — it reads it from your own profile. |
| **A Vyrion account** | Section 4. Sandbox is enough for everything up to section 10. |
| **An EVM wallet with funds** | Only for topping up the Vyrion balance. Section 5. Not needed if you fund Vyrion some other way. |

Only **Día** is implemented through checkout. Carrefour, Jumbo and Disco work for search and
price comparison and are refused by the payment tools with a message saying so.

## 2. Install and build

```bash
cd mcp-server
npm install
npx playwright install chromium
npm run build
```

Verify before configuring anything:

```bash
npm test     # 474 unit tests, no network, no browser
```

If those pass, the money math, the redactor, the keystore, the classifier and the state
machine are all behaving. They are the parts where a bug is expensive.

```bash
cp .env.example .env
```

Leave `.env` as-is for now. Search already works; the rest of this guide fills it in.

## 3. Registering the MCP server in your client

**Claude Code** — from the repository root:

```bash
claude mcp add supermercado -- node /absolute/path/to/mcp-server/dist/index.js
```

**Claude Desktop** — in `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "supermercado": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "RETAILER": "dia",
        "SESSION_PASSPHRASE": "…",
        "WALLET_PASSPHRASE": "…",
        "VYRION_API_KEY": "sk_test_…"
      }
    }
  }
}
```

Passphrases go in the client's `env` block rather than `.env`, because the server runs over
stdio with no terminal to prompt on and no guarantee that `.env` is loaded. See section 12
for what that means for where your secrets end up.

Restart the client, then ask it to run **`diagnose`**. This is the first thing to do in
conversation, and from here on the rest of this guide can be driven from inside the chat
rather than read front to back: `diagnose` prints a four-step readiness checklist, names the
single next thing to do, and prints the resolved configuration with no secret values in it —
only whether each one is present. Run it again after every change; it is also the fastest way
to tell a configuration problem from a store problem.

```
Setup
  · 1. Store account linked
  · 2. Card issuer configured
  · 3. Wallet top-ups available (optional)
  · 4. Live spending enabled

NEXT — store account linked:
  Set SESSION_PASSPHRASE (8+ characters) in your MCP client's env block, restart it,
  then run link_marketplace_account.
```

Steps 1 and 2 are what a purchase needs. Steps 3 and 4 are deliberate opt-ins — step 3 only
matters if you want the server to move crypto for you (section 5), and step 4 is the live-money
switch (section 10). Search and price comparison work before any of it.

Twenty tools register. Ten are read-only (`search_products`, `price_check`, `view_cart`,
`get_cart_link`, …) and work with an empty `.env`. Ten are the checkout half
(`link_marketplace_account`, `set_delivery_address`, `build_cart`, `review_order`,
`check_funds`, `replenish_wallet`, `approve_payment`, …) and load configuration lazily, so a
missing Vyrion key breaks only the tools that need one.

## 4. Vyrion: account, API key, sandbox vs live, choosing a BIN

1. Sign up at **vyrioncard.com** and create an API key in the dashboard.
2. Put it in `.env` as `VYRION_API_KEY`.

**Sandbox vs live is the key prefix, not a separate setting.** `sk_test_…` is sandbox,
`sk_live_…` is real money. Two catches guard the live path:

- A `sk_live_` key with `ALLOW_LIVE` unset is a **startup error**. The server refuses to run
  in a state where one mistyped tool call spends real money.
- Even with `ALLOW_LIVE=1`, `approve_payment` requires you to type the exact ARS total back.
  A mismatch aborts before a card exists.

**Choosing a BIN.** A BIN is the card range your virtual card is issued on, and Argentine
gateways accept them per-BIN, not per-category. `GET /bins` returns them with an acceptance
rate; the client filters to 3DS-capable ones and ranks them, and `pickBin` takes the top of
that list. You normally don't choose — but you can pin one with `bin_id` on `approve_payment`,
which is what you do after a decline:

```bash
npm run dryrun -- --no-browser     # prints the ranked BIN list; touches nothing
```
```
approve_payment  bin_id: "<the next one down>"
```

You have already established that Día accepts international crypto cards — you tested it with
a Kast card, selecting *"tarjeta de crédito"* and filling the form by hand. That retires the
category-level risk. The residual risk is narrow and specific: Kast and Vyrion are the same
class of card but not the same BIN. Hence the ranked list, and hence a minimal first basket.

**Fund the Vyrion balance before you need it.** The rule this system is built around: a
purchase pays from **settled** balance only. `pending_deposits` never counts toward one — a
deposit that hasn't confirmed is not money you have. If the wallet holds $20 and the order is
$20, you buy now; your top-up covers the next one. No checkout ever waits on a block.

## 5. Crypto wallet: keystore, funding, asset

This section is only needed for `replenish_wallet`. If you top up Vyrion from an exchange or
by hand, skip it entirely — everything else works without `RPC_URL` or a keystore.

### Creating the encrypted keystore

```bash
npm run build
node dist/keystore-cli.js --new       # generate a fresh wallet
node dist/keystore-cli.js --import    # encrypt a key you already have
node dist/keystore-cli.js --show      # print the address; no passphrase needed
```

`--new` generates a wallet and writes it to `KEYSTORE_PATH` as a scrypt-encrypted Web3 Secret
Storage keystore (the ethers v6 standard format — other tools can open it with the same
passphrase). It prompts for a passphrase twice with echo off.

`--import` reads an existing private key **from stdin, never from an argument**. Arguments
show up in `ps`, in your shell history and in any process listing; a private key must not.
The plaintext key is encrypted and dropped; nothing writes it anywhere.

Back up **both** the keystore file and the passphrase. Neither is recoverable from the other,
and nothing here keeps a copy of either.

If `WALLET_PASSPHRASE` is already exported, the CLI uses it instead of prompting.

### Funding the Vyrion wallet

```
replenish_wallet  amount: "25.00"                        → a quote; nothing is signed
replenish_wallet  amount: "25.00"  confirm_amount: "25.00" → signs and broadcasts
```

Omitting `confirm_amount` quotes the transfer and stops. With it, the key is decrypted for
exactly one signature, the transfer is broadcast, and **the tx hash comes back immediately** —
it does not wait for confirmations. That is deliberate: this path must never be able to block
a checkout.

Needs `RPC_URL` and a wallet holding the funding asset plus a little native currency for gas.

### Choosing the asset

| `FUNDING_ASSET` | |
|---|---|
| `usdt` *(default)* | Signable here. Contract known for chains 1, 137 and 42161; set `USDT_ADDRESS` on any other. Stable against the USD amount the card is funded in, which is the point. |
| `eth` | Signable here. Its value moves against the card's USD denomination between your top-up and your purchase. |
| `btc`, `sol` | Accepted by Vyrion, but this system signs EVM transactions only. `replenish_wallet` says so rather than pretending; send those to the deposit address by hand. |

**Vyrion supports no Stellar/XLM deposits**, despite the repository name. Replenishment is EVM.

## 6. TypeSafe / Jev API key (and running without it)

Jev is **layer 3 of a four-layer classifier**, not the thing that drives the browser. It
cannot navigate, click or touch a DOM — Playwright does all the driving. Its job is answering
"what screen is this?" for the screens the deterministic layers don't recognise.

| Layer | | Needs a key |
|---|---|---|
| 1 | VTEX's own orderForm + URL hash — exact, free, unit-tested against saved JSON | no |
| 2 | Known-modal registry — cookie banner, address confirmation, slot picker, upsells | no |
| 3 | **Jev** — classifies the residual, with a confidence score | yes |
| 4 | Escalate to you — screenshot, page summary, "what should I do?" | no |

To enable it: create a key at `docs.typesafe.ai`, set `TYPESAFE_API_KEY` and `JEV_ENABLED=true`.

**Running without it is fully supported and is the default.** `JEV_ENABLED=false` runs layers
1, 2 and 4: strictly less capable — the loop asks you about screens it would otherwise have
classified — and never less safe.

Three rules hold when it is on:

1. **Fail closed.** Confidence below `JEV_MIN_CONFIDENCE` (0.75) or an unreachable API stops
   the run and escalates. It never guesses and never blind-retries.
2. **Never the authority on an amount.** Totals are read numerically from the orderForm and
   compared exactly. Jev can veto a payment; it can never approve one.
3. **Never sees card data.** The page extract is built from structure — URL, headings, button
   labels, field *labels*, error text, totals — never field values, and it goes through the
   redactor before leaving the process.

## 7. Linking your Día account

```
link_marketplace_account
```

A **headed** Chromium window opens on Día's login page and waits (default 5 minutes,
`timeout_minutes` to change it, up to 30). You log in yourself: email, password, whatever 2FA Día asks
for. When the session is live, the cookies are encrypted with `SESSION_PASSPHRASE` and saved
to `.secrets/dia.session.enc`, and the window closes.

**Your password is never read, never typed and never observed.** The login capture has no
`type` action, does not read input values and takes no screenshots. It waits for a logged-in
session to exist and then stores the cookies — which is all it needs.

Check and manage it:

```
session_status                        → is a session saved, and how old
session_status  check_live: true      → opens the store and confirms it still works
unlink_marketplace_account            → deletes the vault
```

Sessions expire. When one does, `session_status` says so and the checkout tools stop with a
message telling you to re-link rather than half-completing something.

## 8. Configuration reference

Every variable, what it does, and what happens if it's wrong. `diagnose` prints the resolved
values. Validation lives in `src/config.ts` and runs at startup: a bad value is an error
before anything happens, not a surprise in the middle of a purchase.

### Store

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `RETAILER` | `dia` | `dia`, `carrefour`, `jumbo`, `disco`. Unknown value → startup error naming the valid ones. Any value but `dia` → search works, checkout tools refuse. |

### Secrets

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `SECRETS_DIR` | `.secrets` | Session vault, keystore (by default) and escalation screenshots. Unwritable → the first save fails with the path. |
| `KEYSTORE_PATH` | `$SECRETS_DIR/wallet.keystore.json` | Where `keystore-cli` writes and `withSigner` reads. Missing at signing time → error pointing at section 5. |
| `SESSION_PASSPHRASE` | — | Encrypts the session vault. Under 8 characters → refused. Wrong value → the vault won't decrypt; re-link. **Lost = re-link**, which costs one login. |
| `WALLET_PASSPHRASE` | — | Decrypts the keystore. Wrong value → decryption fails closed, nothing is signed. **Lost = the wallet is gone.** |

### Vyrion

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `VYRION_API_KEY` | — | `sk_test_` sandbox, `sk_live_` real. Missing → checkout tools error, search unaffected. `sk_live_` without `ALLOW_LIVE` → **startup error**. |
| `VYRION_BASE_URL` | Vyrion's API | Override for a proxy or a mock. Wrong → connection errors on every card call. |
| `ALLOWED_MCC` | `5411,5499,5311` | Merchant categories the card may be used at, applied to every card. Too narrow → a legitimate decline at the store. Empty → no category ceiling; don't. |
| `ALLOW_LIVE` | `0` | The second catch on real money. Off → `approve_payment` and `replenish_wallet` refuse even with a correct restated amount. |

### FX

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `FX_BUFFER` | `0.15` | Cards are funded at `ceil(total / rate × (1 + buffer))` and the spending limit is set to exactly that. Too low → the card declines on an unfavourable settlement rate. The buffer is float, not spend: the residual returns to your wallet when the card is terminated. Outside 0–1 → startup error. |
| `ARS_PER_USD` | *(looked up)* | Pins the rate, bypassing the network. Useful for dry runs and tests. Outside 50–100000 → startup error. A stale pin sizes the card wrongly. |

### Wallet

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `FUNDING_ASSET` | `usdt` | `btc`, `eth`, `sol`, `usdt`. Anything else → startup error. `btc`/`sol` → `replenish_wallet` explains it can't sign those. |
| `CHAIN_ID` | `1` | Chain the EOA sends from. Mismatched with `RPC_URL` → the transfer reverts or goes to the wrong network. |
| `RPC_URL` | — | Only for reading the balance and broadcasting a top-up. Missing → `replenish_wallet` errors; everything else works. |
| `USDT_ADDRESS` | known for 1, 137, 42161 | The token contract. Unknown chain without it → error telling you to set it or switch to `eth`. |

### Jev

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `JEV_ENABLED` | on if `TYPESAFE_API_KEY` is set | On without a key → startup error. Off → layers 1, 2 and 4 only. |
| `TYPESAFE_API_KEY` | — | Classifier only; never receives card data. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai/v1/systemone` | Override for a mock. |
| `JEV_MIN_CONFIDENCE` | `0.75` | Below this the loop escalates instead of acting. Lower → the classifier acts on weaker evidence in a flow that spends money. |

### Browser

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `HEADLESS` | `true` | Checkout visibility. The login capture is always headed regardless. |
| `MAX_STEPS` | `25` | Hard ceiling on loop iterations, so a confused page can't spin forever. Too low → a legitimate flow escalates. |
| `MAX_MINUTES` | `4` | Wall-clock ceiling on the same loop. 0.5–30. |
| `SLOWMO_MS` | `0` | Delay between actions. Useful with `HEADLESS=false` when watching a run. |

### Smoke test

| Variable | Default | |
|---|---|---|
| `SMOKE_QUERY` | `leche descremada` | Search term for the read-only four-store regression. |
| `SMOKE_POSTAL_CODE` | `1425` | Postal code it prices against. |

## 9. Running a dry run

The dry run does **everything a real purchase does except the last step**: it searches, opens
your real session, writes to your real cart, drives the real checkout to the card form — and
then prints the exact Vyrion request bodies it *would* have sent, redacted, instead of
sending them. No card is created. Nothing is submitted.

That "everything but the last step" property is the point. The parts that break are the
browser parts, and this exercises all of them.

```bash
# Config, Vyrion reads and FX only — touches nothing of yours
npm run dryrun -- --no-browser

# The full rehearsal
npm run dryrun -- --cp 1425 --search "leche descremada" \
                  --street "Av. Corrientes" --number 1234

# Review whatever is already in your cart, without adding
npm run dryrun -- --skip-cart
```

Useful flags: `--sku id:qty` (repeatable, instead of searching), `--qty`, `--clear-first`,
`--complement`, `--city`, `--province`, `--phone`, `--postal-code`, `--bin`, `--minutes`.

**One thing here is genuinely destructive: it writes to your real cart**, and it says so out
loud when it does. Use `--skip-cart` if you'd rather it didn't.

A clean run ends:

```
   Cards created: 0.  Payments submitted: 0.  Nothing was charged.
   ✓ dry run clean
```

and exits 0. Any problem exits non-zero with the specifics.

**Sandbox run.** With `sk_test_`, the full card codepath runs: create, fund, read details,
attempt payment. Día will decline a sandbox card — that is the expected result. What's being
tested is that the decline is handled cleanly, the card is terminated and the balance comes
back.

**Recording a checkout.** The first time, and whenever Día changes its flow, record a real
one so the deterministic layers are built against screens that exist:

```bash
npm run record          # headed; you drive; stop AT the payment form
```

It polls every second and captures a fixture whenever the page becomes a different page. On
exit it names the screens the deterministic layers did *not* recognise — those are the ones
worth turning into a `modals.ts` entry. Output lands in `fixtures/recordings/<timestamp>/`
relative to `mcp-server/`, and **the orderForm is scrubbed before it touches disk**: name,
email, DNI, phone and street are replaced with same-shaped placeholders, so a fixture is a
description of a screen rather than a copy of your identity. There is a unit test that fails
if any code path in `record.ts` ever writes an unscrubbed one.

Do not place an order to record one. Stop at the payment form.

## 10. Running a real purchase

Set `ALLOW_LIVE=1` and a `sk_live_` key. Then, in conversation:

```
search_products       "leche descremada"          → pick what you want
link_marketplace_account                          → you log in (once)
set_delivery_address  street, number, postal_code, …
build_cart                                        → items land in YOUR real cart
review_order                                      → itemized total + a link to open it
check_funds                                       → settled balance vs required USD
approve_payment       confirm_total_ars: "12345,67"
```

**You are asked for exactly two things:** your address (name and DNI are read from your own
Día profile — never asked for), and the exact ARS total, typed back.

The amount is parsed the Argentine way: a comma is always the decimal separator, and a lone
dot is decimal only when one or two digits follow it. `12.345` is twelve thousand three
hundred and forty-five pesos. `12.345,67` and `12345.67` are the same number. An amount that
can't be read unambiguously is refused rather than guessed — a misparse here aborts a payment,
which is the safe direction.

**What the two gates actually guard.**

- `approve_payment` re-reads the total immediately before paying and **aborts on any
  mismatch** with what you approved. Prices and stock drift mid-checkout; you are never
  charged a number you didn't confirm. Changing the address or the cart invalidates a prior
  approval for the same reason — a new address re-quotes shipping.
- `replenish_wallet` is separate, independent and non-blocking. It never gates a purchase.

**The order of operations inside `approve_payment`**, which matters:

1. Re-read and re-check the total against what you typed.
2. Drive the checkout to the payment form. **If it doesn't get there, stop — no card was
   created and nothing was paid.**
3. *Only then* create and fund the card, sized at total + buffer, spending limit set to
   exactly that, categories whitelisted.
4. Fill the form (*"tarjeta de crédito"*), answer 3DS, submit.
5. Terminate the card in a `finally` — whatever happened above. The residual returns to your
   wallet instantly.

A failed drive never leaves funded plastic behind.

You get back the order number, the order-status URL, and the matching Vyrion transaction. If
something stopped short, you get a link to your cart — untouched and still there.

**Make the first live basket the smallest one you can.** BIN acceptance is the one thing a
dry run cannot answer.

## 11. Troubleshooting

**Start with `diagnose`.** It prints the resolved configuration with no secret values in it,
and separates a configuration problem from a store problem in one step.

| Symptom | What's happening | Fix |
|---|---|---|
| "No saved session" / everything checkout-ish refuses | No vault, or `SESSION_PASSPHRASE` doesn't match the one that wrote it | `link_marketplace_account`. If it was a passphrase change, `unlink_marketplace_account` first. |
| Session expired mid-run | Día invalidated the cookies | `session_status check_live: true` confirms it; re-link. Your cart survives — it lives at the store. |
| Card declined | Usually BIN acceptance at the gateway | `approve_payment bin_id: "<next in the ranked list>"`. The declined card was already terminated and the balance returned. |
| `check_funds` blocked despite a recent deposit | Pending deposits never count toward a purchase, by design | Wait for it to settle, or `replenish_wallet`. The order draft is preserved. |
| 3DS timed out | The one-time code is a ~3-minute race, and the page must be waiting when it arrives | Retry. If it happens repeatedly, run with `HEADLESS=false` and watch where it stalls. |
| Out of stock mid-checkout | The store changed the cart under you | `review_order` re-reads and shows the new total; a changed total invalidates any prior approval. Re-approve or adjust. |
| "the loop stopped to ask a question" | An unrecognised screen — layer 4 doing its job | Read the summary and screenshot (under `$SECRETS_DIR/screenshots`). If it recurs, `npm run record` it and add a `modals.ts` entry. |
| Stalls, then escalates | Three non-advancing iterations | Usually a modal the registry doesn't know. Same fix: record it. |
| Startup error about `sk_live_` | A live key with `ALLOW_LIVE` unset | Intentional. Set `ALLOW_LIVE=1` only when you mean it. |
| `replenish_wallet` errors on `RPC_URL` | Not set | Section 5 — or fund Vyrion another way; nothing else needs it. |
| Amount refused as unreadable | The es-AR parser won't guess | Write it as `12345,67` or `12345.67`. |
| Playwright can't launch | Chromium not installed | `npx playwright install chromium`. |
| Tests fail after an edit | — | `npm run build` first; the suite runs against `dist/`. |

Running with `HEADLESS=false SLOWMO_MS=250` is the single most useful diagnostic for anything
browser-shaped. You watch it happen.

## 12. Security model

### What is stored, where, and under what

| | Where | Protected by |
|---|---|---|
| **Your Día password** | **Nowhere.** You type it into a headed browser. | Never read, never typed, never observed |
| Session cookies | `.secrets/dia.session.enc` | AES-256-GCM under a scrypt-derived key from `SESSION_PASSPHRASE` |
| EOA private key | `KEYSTORE_PATH`, scrypt-encrypted Web3 Secret Storage keystore | `WALLET_PASSPHRASE`; decrypted into memory for one signature |
| `VYRION_API_KEY` | `.env` or your MCP client's config | Filesystem permissions. `sk_live_` refused unless `ALLOW_LIVE=1` |
| `TYPESAFE_API_KEY` | same | Classifier only; never receives card data |
| Your name, DNI, address | Read from your Día profile at run time | Not persisted by this system |
| **Card PAN / CVV** | **Process memory, for seconds** | Never logged, never written to disk, never returned through MCP, never in a Playwright trace |
| 3DS one-time code | Process memory | — |

### The redactor

`secure/redact.ts` wraps every log line and every MCP response, masking 13–19 digit runs
(PANs), `sk_(test|live)_…` keys, `0x…` 64-hex strings (private keys), CVV-shaped values near
card fields, DNI numbers and cookie values. It is unit-tested against PANs of 13, 15, 16 and
19 digits.

### The tracing kill-switch

Playwright tracing, video and screenshots are **hard-disabled** during the payment step. A
trace file containing a PAN would be the worst artifact this project could produce, so the
payment window is wrapped in a guard rather than relying on remembering not to enable it.

### Four independent ceilings on a card

1. Funded at exactly `total + buffer` — it cannot spend money it doesn't hold.
2. `spending_limit` set to exactly the funded amount — the buffer can't be spent.
3. `allowed_categories` whitelisted to grocery MCCs.
4. Terminated after settlement, in a `finally`.

A card that leaked buys roughly one basket of groceries at a grocery store, once.

### If something leaks

| | Do this |
|---|---|
| Session vault copied | `unlink_marketplace_account`, then change your Día password — that invalidates the stolen cookies. |
| `SESSION_PASSPHRASE` leaked | Same. The vault is only as good as the passphrase. |
| Keystore file copied | Move the funds now. An encrypted keystore is a *delay*, not a wall. |
| `WALLET_PASSPHRASE` leaked with the file | Assume the key is compromised. New wallet (`keystore-cli --new`), move everything. |
| Vyrion API key leaked | Revoke it in the dashboard. It can create and fund cards from your balance. |
| A card looks compromised | `DELETE /cards/{id}` returns the residual instantly; the ceilings above cap what happened in between. |

### Two limits worth knowing

**Passphrases in an MCP client's config sit on disk in plaintext.** The server runs over
stdio with no terminal to prompt on, so they come from the environment. Encrypting the vault
and the keystore protects them from *file copying*, not from someone who already has your
client's configuration. Filesystem permissions on that file are load-bearing.

**Día's `robots.txt` disallows `/checkout/*`.** That governs crawlers, not a person driving
their own logged-in session through their own browser — but it is your account and your call.
