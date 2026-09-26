# Deploying changuito

Two halves, in this order: the contracts on Stellar testnet, then the app on
Vercel. The contracts are already deployed and their ids are committed in
`deployments.json`, so **if you are only deploying the app, skip to part 2.**

---

## Part 1 — the contracts

You need this if you changed anything under `contracts/`, or if testnet has
been reset since the ids in `deployments.json` were recorded.

### 1.1 Install the toolchain

```bash
rustup target add wasm32v1-none
brew install stellar-cli          # or: cargo install --locked stellar-cli
stellar --version
```

Built and verified with CLI 25.1.0 against a protocol-28 ledger. A newer CLI is
fine; if yours is much older, upgrade rather than pinning `soroban-sdk` down to
meet it.

### 1.2 Point the CLI at testnet

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### 1.3 Run the deploy script

```bash
npm run deploy:testnet
```

That one command does all of it:

1. Creates the two identities if they are missing — `changuito-resolver` (the
   token admin *and* the escrow resolver: one hot key, because a demo with two
   is two keys to leak) and `changuito-treasury` (an address only; nothing ever
   signs for it) — and tops both up from friendbot.
2. Builds both contracts for `wasm32v1-none`.
3. Deploys `mock_usdc` with the resolver as admin, then `escrow` with the
   resolver, the treasury and the token id as constructor arguments.
4. Writes `deployments.json`, and generates `apps/web/lib/deployments.ts` from
   it.
5. Generates TypeScript bindings into `packages/escrow-bindings` and
   `packages/usdc-bindings`, then rewrites each one's `package.json` to be a
   workspace package that shares the app's exact `@stellar/stellar-sdk`
   version. That last part matters: two copies of the SDK in one process means
   two sets of XDR classes, and `instanceof` quietly stops working.
6. Verifies the result with live `config`, `symbol` and `decimals` calls.

It is idempotent. A contract already recorded is left alone, so re-running
after a failure halfway through resumes instead of stranding the first
contract. To force new ids:

```bash
npm run deploy:testnet -- --force
```

### 1.4 Commit what changed

```bash
git add deployments.json apps/web/lib/deployments.ts packages/*-bindings
npm test          # the suite checks the bindings and deployments.json agree
```

### 1.5 Put the resolver secret where the app can read it

```bash
stellar keys show changuito-resolver     # prints S…
```

Paste it into `apps/web/.env.local` as `STELLAR_RESOLVER_SECRET`. That file is
gitignored. The app refuses a key whose public address does not match the
resolver the contracts were deployed with, so a stale one fails loudly rather
than at the first mint.

### 1.6 Issue the testnet USDC preview pays with

Run once per testnet reset, and only if `contracts.usdc.issuer` is `null` for
testnet in `deployments.json`.

```bash
node scripts/setup-demo-asset.mjs --demo <identity> --deposit <identity>
```

Both arguments are `stellar keys ls` identity names: the demo wallet that
preview pays *from*, and the account `DEPOSIT_ADDRESS_TESTNET` names, which it
pays *to*. The script checks the second really is that address before it signs
anything, and refuses outright if testnet already has a classic issuer.

**Why this exists rather than reusing `mock_usdc`.** The Soroban token
(`contracts.usdc.id`) is a pure SEP-41 contract: balances live in contract
storage and transfers are contract events, so there is no classic payment
record with a memo field for the deposit rail to read. Minting billions of it
to the demo wallet would fund a balance the rail cannot see — which is why
`depositAssetFor` treats a falsy issuer as native XLM, and why preview paid in
lumens until this ran. A classic asset means preview rehearses the mainnet path
exactly: trustline, asset code, issuer, memo. With play money.

What the script does, in order: friendbots the demo wallet and the deposit
account if either has no ledger entry yet; generates and funds a fresh issuer;
adds a `USDC:<issuer>` trustline from both sides of the rail, because a classic
asset cannot reach an account that has not trusted it; pays **1,000,000,000
USDC** to the demo wallet; then sets the issuer's master weight to `0` and
deletes the identity. That last step is the point — it
locks the account, so no further issuance is possible by anyone including us,
and "a billion is the supply" becomes a property of the ledger rather than a
promise in a comment. **No secret passes through the process**: every signature
is made by the `stellar` CLI from its own keystore.

Then record the issuer and regenerate — do not hand-edit the generated module,
it carries a do-not-edit header:

```bash
# set contracts.usdc.issuer for testnet in deployments.json to the printed G…
node scripts/write-deployments-module.mjs
node scripts/check-deposit-account.mjs testnet   # trustline present, asset matches
git add deployments.json apps/web/lib/deployments.ts
npm test
```

`contracts.usdc.id` stays as it is. The Soroban token still backs the dormant
escrow; it is simply no longer on the deposit rail.

---

## Part 2 — the app on Vercel

### 2.1 Get the two API keys

- **Anthropic** — [console.anthropic.com](https://console.anthropic.com) → API
  keys. This is what runs the shopping agent.
- **Pollar** — the [Pollar dashboard](https://pollar.xyz) → your application →
  API key, with the network set to **mainnet**. This one is publishable and
  ships in the browser bundle by design.

Mainnet, and only mainnet. A Pollar dashboard key is network-scoped, this
project holds one, and [2.3](#23-preview-and-production) is why that is a
design rather than a gap.

### 2.2 Import the repository

In Vercel: **Add New → Project**, import `raptor0929/changuito`.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | `apps/web` |
| Build command | *(leave as the default)* |
| Install command | *(leave as the default)* |
| Node.js version | **22.x** |

Two of these are not optional:

- **Root directory `apps/web`.** It is a workspace, and Vercel still installs
  from the repo root, so the MCP package and the bindings resolve normally.
- **Node 22.x.** `@stellar/stellar-sdk@17` requires ≥ 22.12 and the install
  fails outright on 20.

### 2.3 Preview and production

One deployment, one URL, two apps — and **which one a visitor is in is decided
by whether Pollar has a session**, evaluated in the browser (`lib/app-mode.ts`).

| | **preview** | **production** |
|---|---|---|
| who is it | nobody signed in | a Pollar session |
| network | testnet | mainnet |
| who pays | **the demo wallet, server-signed** | their own wallet |
| money | the USDC issued in [1.6](#16-issue-the-testnet-usdc-preview-pays-with) | real Circle USDC |
| Postgres | **never touched** | chat, orders, the card binding |
| the card | one per código, given back with the basket | one per customer, kept |

**Signing in *is* the crossing.** There is no mode variable, no toggle and no
second deployment, and there must not be one: a mode derived from the session
cannot disagree with who you are, which deletes the entire class of bug where
somebody spends real money in what the screen calls the demo. The control
beside the balance is a read-only badge saying which of the two you are in.

Preview exists so that anyone with the link can search, fill a basket, watch a
**real on-chain payment settle and a real card appear** without connecting
anything. It is a demo with a ledger behind it, not a mock: the only step that
differs from production is who signs the payment.

Two consequences worth knowing before you configure anything:

- **A deployment that sets only the preview half is complete**, not broken. No
  Pollar key, no Vyrion key and no database still gives you the whole demo;
  what is missing is the way out of it, and the sign-in button says so.
- **A guest who runs out of free turns is told to sign in**, which now means
  "switch to spending real money". That is the honest crossing and the copy
  names it. Raise `FREE_TURNS` if the demo feels cramped — the ceiling is your
  Anthropic bill on a public URL, held back by Turnstile and the per-IP cap.

### 2.4 Environment variables

Under **Settings → Environment Variables**, for Production *and* Preview.
Grouped by which of the two apps needs them.

**Always:**

| Name | Value | Exposed to |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | server only |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare → Turnstile | the browser, by design |
| `TURNSTILE_SECRET_KEY` | **required**, the matching secret | server only |
| `KV_REST_API_URL` | set by the Redis integration | server only |
| `KV_REST_API_TOKEN` | set by the Redis integration | server only |
| `FX_ARS_PER_USD` | optional, e.g. `1500` | server only |

**Preview — the demo pays for itself:**

| Name | Value | Exposed to |
|---|---|---|
| `DEPOSIT_ADDRESS_TESTNET` | the `G…` account preview deposits are paid into | server only |
| `DEMO_WALLET_SECRET` | the `S…` for the account pinned as `demoWallet` | server only |

**Production — they pay, and it is remembered:**

| Name | Value | Exposed to |
|---|---|---|
| `NEXT_PUBLIC_POLLAR_API_KEY_MAINNET` | the Pollar key from [2.1](#21-get-the-two-api-keys) | the browser, by design |
| `CHG_SESSION_SECRET` | **required**, `openssl rand -base64 32` | server only |
| `DEPOSIT_ADDRESS_MAINNET` | the `G…` operator account real deposits are paid into | server only |
| `VYRION_API_KEY` | `sk_test_…`, or `sk_live_…` with `ALLOW_LIVE=1` | server only |
| `ALLOW_LIVE` | `1`, and only when you mean it | server only |
| `DATABASE_URL` | the Supabase **pooler** string, port 6543 | server only |
| `REAL_MODE_ALLOWLIST_ADDRESSES` | who may pay — see [2.8](#28-who-may-pay) | server only |
| `REAL_MODE_OPEN_TO_ALL` | optional, `1` to drop that list — read [2.8](#28-who-may-pay) first | server only |

**Still configured, no longer reachable from the UI:**
`STELLAR_RESOLVER_SECRET`, `STELLAR_RESOLVER_SECRET_MAINNET`,
`FAUCET_ALLOWLIST_ADDRESSES`, `FAUCET_OPEN_TO_ALL`. These belong to the escrow
rail and the testnet faucet, and neither has a button any more — see
[Using it](#using-it-the-escrow-walkthrough-dormant). Leave them set if they
are set; nothing calls them.

`DEPOSIT_ADDRESS_*` is **public by nature** — it is printed on screen for the
shopper to pay — and no secret for either one is anywhere near this deployment.
Nothing in the app can pay *out of* a deposit account on either network, and a
refund is done by hand. Unset, the deposit screen answers 503 and says so.

> **One open item.** The two deposit addresses are currently the same account.
> Separate ledgers, so not a collision — but one secret key then controls both
> the demo's play money and every real deposit. Splitting them costs a keypair
> and is cheaper now than later.

`DEMO_WALLET_SECRET` is the one secret key this deployment holds, and the
reason preview can settle a payment for a visitor with no wallet. It is bounded
by four separate things rather than by intent (`lib/server/demo-wallet.ts`):
the asset is play money from a locked issuer, the destination is
`DEPOSIT_ADDRESS_TESTNET` with no parameter to change it, `demoWallet` is `""`
on mainnet so a mainnet secret can never match the derived public key, and the
value is read at call time so a build without it still succeeds. Never
`NEXT_PUBLIC_`, and never echoed — not even a prefix.

`VYRION_API_KEY` decides whether the card exists: unset, the card button is
never rendered rather than rendered and broken. `ALLOW_LIVE=1` is the second
catch — an `sk_live_` key is refused without it, and an `sk_test_` key ignores
it, so spending real money takes both.

`TURNSTILE_SECRET_KEY` is the one that fails *shut*. Set it and the gate
enforces; leave it unset in production and `middleware.ts` answers 403
`solo_humanos` on every `/api/*` route except `/api/human`, so chat, quote and
checkout are all dead. That is deliberate — an open agent endpoint on a public
URL bills someone's Anthropic key. The site key is public and deliberately does
**not** affect the gate, but without it the widget never mounts, so nobody can
get through.

`CHG_SESSION_SECRET` signs the `chg_user` cookie that records a Pollar login.
Production reads nothing else for it: unset, sign-in answers 503 and everyone
stays in preview. The cookie is issued only after the wallet signs a login
message (SEP-53), so an address alone is not a login. Rotating it signs
everyone out, which costs them one signature.

Only the two `NEXT_PUBLIC_` names reach the browser. Do not add the prefix to
any of the others.

### 2.5 The database

Production only. Preview writes nothing, by design and by construction — there
is no proven address in preview, so `archiveChat` answers `'guest'`, the card
binding has no owner to key on, and the order table is never reached.

1. **supabase.com → New project.** Region: match your Vercel functions.
2. **Project Settings → Database → Connection string.** Take both: the
   *transaction pooler* on port **6543** and the *direct* connection on **5432**.
3. Put them in `apps/web/.env` locally as `DATABASE_URL` and `DIRECT_URL`, with
   `?sslmode=require` on each.
4. Apply the schema:

```bash
npm run db:migrate     # supabase/migrations/*.sql, in order, over DIRECT_URL
npm run db:status      # what is applied, what is pending
npm run db:invariants  # the constraints, against the real database
```

5. In Vercel, set **`DATABASE_URL` only**. Migrations are a laptop operation.

**The 6543/5432 difference is the part that fails only under load**, which is
why it is spelled out here rather than left to the connection-string picker.
6543 is transaction-mode pooling: a connection is held for one statement and
given back, which is exactly the shape of a lambda per request. 5432 is a
session, which DDL and advisory locks need and which a request handler must
never open — `lib/db.ts` reads `DATABASE_URL` and deliberately does not read
`DIRECT_URL`, because a route that quietly took a session connection would work
perfectly in development and exhaust the database at traffic rather than at
deploy.

`prepare: false` is already passed and is not optional: the pooler rejects
named prepared statements, and the failure is a confusing "prepared statement
already exists" on the *second* request.

Nothing here throws at import. A deployment with no `DATABASE_URL` boots and
serves the chat half; the routes that need a record answer 503 rather than,
say, minting a second card for somebody who already has one.

Retention, when you get to it: expiring a transcript must **orphan** its order,
never erase it. The `chat` foreign key on `orders` deliberately does not
cascade — a conversation is a conversation and an order is evidence that money
moved (`supabase/migrations/0002_order_identity.sql`).

### 2.6 Conversation history and quotas

Redis, and it is **no longer on the money path** — that moved to Postgres in
2.5. What it still holds is the agent's in-flight turn, the chat and faucet
quotas, and the local model's breaker and lanes. Losing it costs chat
continuity and the breaker, not a deposit.

Required in production all the same, because the quotas fail closed: without
it (or with Redis down) `/api/chat` answers 503 instead of running unlimited
turns on your Anthropic key.

1. **Storage → Create Database → Marketplace → Upstash for Redis.**
2. Region: match your functions (Vercel's default is `iad1`). Leave Read
   Regions empty.
3. **Turn Eviction on.** Off means writes *fail* once the database is full.
   This is a cache — dropping the oldest session is the right answer, and a
   conversation is roughly 100 KB with a one hour TTL.
4. **Connect Project.** That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

Use the REST pair, not `REDIS_URL` or `KV_URL`: those are `rediss://` strings
for a TCP client, and one TCP connection per lambda is the connection-limit
problem an HTTP client exists to avoid.

Locally, copy the two into `apps/web/.env`. Leave them out and an in-process
Map stands in, which on one machine is the same guarantee for free.

A reload starts a new chat and the old one is still there: `chat-store.ts`
keeps the blocks in localStorage and the rail lists them. For a signed-in
shopper the transcript is also in Postgres, which is what outlives the TTL and
a cleared browser.

### 2.7 Deploy a preview first

Push to a branch, let Vercel build it, and check on the preview URL before
promoting.

The rate comes back:

```bash
curl "https://<preview>/api/quote?centavos=1234500"
```

And the chat **streams** rather than arriving in one lump. If it arrives all at
once something is buffering the SSE response — the route sets
`X-Accel-Buffering: no` for exactly this, and the runtime must be `nodejs`,
never edge.

Then walk preview end to end, which is the whole point of it: load with no
session, build a basket, pay with the demo wallet, watch the deposit go from
waiting to confirmed, and see the card. Then open the payment on Horizon and
confirm it is **`USDC:<issuer>` with the código in the memo** — not XLM, and
not a Soroban event. Then confirm no row landed in `chat`, `orders` or
`card_owner`.

Then **Promote to Production**.

### 2.8 Who may pay

`REAL_MODE_ALLOWLIST_ADDRESSES` decides who may pay with real money. Same
format and the same deny-by-default rule as the old faucet list: empty in
production means nobody, Previews included. It is enforced **after** the
wallet's SEP-53 signature is verified, so it is checked against a proven
address rather than a claimed one. Passkey wallets (`C…`) cannot sign that
message, so testers need a custodial `G…` account.

`POST /api/deposit` goes through `lib/deposit-gate.ts` first, and `POST
/api/card` re-checks that the código it is handed belongs to a wallet that got
through. Four states, and what each means at the checkout:

| State | How you get it | At the checkout |
|---|---|---|
| **open** | not production, no list | pays with no signature — what keeps `next dev` painless, and what preview runs on |
| **allowlist** | the list is non-empty | on the list, and signs once before the deposit screen |
| **public** | `REAL_MODE_OPEN_TO_ALL` set | anybody, and **still signs once** |
| **disabled** | production, empty list | refused, before an amount or an address is quoted |

One signature, taken before any money moves, and not asked for again at the
card. A proof lives five minutes and a deposit can take longer than that to
confirm, so a second one would refuse a shopper who has already sent real USDC
— the worst available moment to fail, and one that ends in a manual refund.

`REAL_MODE_OPEN_TO_ALL=1` drops the list and lets any wallet pay. Same yes-words
as the faucet's old switch, and deliberately a separate variable. **It drops the
list, not the signature**: "anybody may pay" and "nobody has to prove who they
are" are different sentences and only the first is on offer, which costs a
signed-in shopper one tap and costs a script the whole exercise.

Two things that are **not** variables, and will stop a first real payment dead:

1. **`DEPOSIT_ADDRESS_MAINNET` needs a USDC trustline** before anyone pays into
   it. A classic asset cannot reach an account that has not opted in, and the
   payment fails at submit. Check it:

   ```bash
   node scripts/check-deposit-account.mjs mainnet
   ```

   It reports whether the account exists, whether the trustline is there, and
   whether the asset matches the issuer in `deployments.json` — Circle's
   `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` on mainnet. The
   buyer's own trustline the app handles, as a one-time step in the payment
   screen.
2. **A 3DS-capable BIN on the Vyrion account.** An empty list is a 502 *after*
   the deposit has landed, which is the wrong order to find out in.

Three more Vyrion questions only a live key answers, listed because they decide
whether a kept card is one object topped up or a new card each basket: does
`POST /cards/{id}/fund` raise the spendable balance on a card created without a
`spending_limit`; does a card created *with* a limit refuse to fund past it
(there is no update-limit endpoint, which is why the persistent path sets none);
and does `fundCard` implicitly un-freeze. `allowedCategories` is set at creation
and unchangeable, so a standing balance stays locked to `5411,5499,5311`.

---

## Part 3 — a local model, with Sonnet as the fallback (optional)

Skip this entirely unless you want it. Nothing here is required, and with none
of it configured the agent runs on `claude-sonnet-5` exactly as before.

What it buys: inference on hardware you already own, with the hosted model
catching every case where your machine cannot answer. What it does **not** buy
is capacity — a 16 GB machine runs one model instance, so the honest
description is "your machine answers when it is free, and Sonnet answers
otherwise." On a site with visitors, Sonnet will carry most turns. That is the
design working, not a fault.

### 3.1 Pick a model that fits

The binding constraint on an Apple Silicon Mac is not total RAM, it is the
share macOS hands the GPU — about two thirds of unified memory. On 16 GB that
is ~10.9 GB, and the model's weights *and* its KV cache have to fit inside it.

| Model | Weights (Q4) | Verdict on 16 GB |
|---|---|---|
| `qwen3:8b` | ~5.2 GB | **the default.** Leaves room for a 32k context |
| `qwen3:14b` | ~9.3 GB | better at picking tools, needs KV quantization to fit at all |
| `qwen3:30b-a3b` | ~19 GB | does not fit. Only ~3B params are *active* per token, but all 19 GB must be **resident** — which experts fire changes token to token |

### 3.2 Set the machine up

```bash
ollama pull qwen3:8b

# Bind to localhost only. The tunnel is the way in; nothing on the LAN or the
# internet should reach 11434 directly, because Ollama has no authentication.
launchctl setenv OLLAMA_HOST "127.0.0.1:11434"

# Keep the model resident between requests. Without this Ollama unloads it
# after five minutes idle and the next visitor waits out a 5 GB read from disk.
launchctl setenv OLLAMA_KEEP_ALIVE "-1"

# The context window. This one matters more than it looks: the default is 4096,
# it truncates silently, and the agent sends twelve tool schemas — so the
# truncation cuts the tool definitions themselves and the model starts
# inventing tool names. It cannot be set per-request, because Ollama's
# OpenAI-compatible endpoint ignores `num_ctx`.
launchctl setenv OLLAMA_CONTEXT_LENGTH "32768"

# Halve the KV cache, so a 32k context costs ~2.4 GB instead of ~4.8 GB.
launchctl setenv OLLAMA_FLASH_ATTENTION "1"
launchctl setenv OLLAMA_KV_CACHE_TYPE "q8_0"
```

`launchctl setenv` is read at launch, so **quit and reopen Ollama.app** after
setting these. Confirm with `curl -s localhost:11434/api/tags | jq '.models[].name'`.

A closed lid means no inference. `caffeinate -dimsu` in a terminal keeps the
machine awake and Ctrl-C ends it.

### 3.3 Reach it from the deployment

Two situations, and they need different answers.

**Local dev only — use Tailscale.** Install it on both machines, sign in with
the same account, and point `OLLAMA_URL` at the `100.x` address from
`tailscale ip -4`. No token needed: WireGuard has already authenticated the
device, so there is no public surface at all. This is the easier and safer
option, and it is the one to use while building.

It does not work from Vercel — a lambda is not on your tailnet.

**From a Vercel deployment — use a Cloudflare Tunnel with Access.**

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create changuito-ollama
cloudflared tunnel route dns changuito-ollama ollama.yourdomain.com
cloudflared tunnel run --url http://localhost:11434 changuito-ollama
```

Then, in Cloudflare Zero Trust, put an **Access** application in front of that
hostname and create a **service token** for it. Cloudflare rejects
unauthenticated callers at its own edge, so your Mac never sees the scan
traffic — and port 11434 is never exposed.

Do **not** use `cloudflared tunnel --url http://localhost:11434` on its own.
It prints a working `trycloudflare.com` URL in one command, which is why it is
tempting, but that URL is an unauthenticated, unrotatable bearer token to a
machine in your house. Ollama's API can pull and delete models, so an open
instance is remote control of that directory, and port 11434 is actively
scanned. Use it for a five-minute experiment you are watching, never for
something left running.

### 3.4 Environment variables on Vercel

| Variable | Value |
|---|---|
| `AGENT_PROVIDER` | `auto` |
| `OLLAMA_URL` | `https://ollama.yourdomain.com` |
| `OLLAMA_MODEL` | `qwen3:8b` |
| `OLLAMA_HEADERS` | `{"CF-Access-Client-Id":"…","CF-Access-Client-Secret":"…"}` |

None of them take a `NEXT_PUBLIC_` prefix. `OLLAMA_URL` plus `OLLAMA_HEADERS`
is a credential pair for a machine of yours, and in the client bundle it would
be a public one.

### 3.5 Confirm which model actually answered

The point of the fallback is that a turn reads the same either way, which also
means a laptop that quietly stopped being used is invisible. Two ways to see it:

- The SSE `done` event carries a `brain` field — `qwen3:8b`,
  `claude-sonnet-5`, or `qwen3:8b → claude-sonnet-5` when it switched mid-turn.
- Set `AGENT_PROVIDER=ollama`, which refuses to fall back and shows the reason
  instead. Use it to prove the path works, then set it back to `auto`.

The server log names every refusal: `breaker-open`, `busy`, `unreachable`,
`model-missing`.

### 3.6 What falls back, and when

| Situation | What happens |
|---|---|
| Machine asleep, tunnel down, token wrong | probe fails in ≤2s, Sonnet answers |
| Model not pulled | caught by the probe, Sonnet answers |
| Three consecutive failures | local model taken out for 60s, so the next visitors pay nothing to rediscover it |
| Another visitor mid-basket | `busy` — Sonnet answers rather than queueing |
| Reachable but no first token in 8s | abandoned, Sonnet answers |
| Local model used 150s of the turn | the rest of the basket finishes on Sonnet |
| Failure after text is on screen | visible error, no silent retry — half a sentence cannot be unsaid |

The breaker and the lane counter live in Redis when it is configured, so all
lambdas share one view. Without Redis they are per-process, which is the right
answer for one developer on one machine and the wrong one on Vercel — the same
split as conversation history, for the same reason.

## Using it

**Preview** — no account needed, and this is the demo:

1. Open the site signed out. The badge beside the balance says you are in the
   demo.
2. Ask for a basket — *"armá un desayuno para dos por menos de $10.000"*.
3. When the cart card appears, click **Pagá con USDC**, then **Pagar con
   nuestra plata**. A real payment settles on testnet, carrying the código in
   its memo.
4. The deposit goes from waiting to confirmed. **Generar una tarjeta** then
   mints one for that código — it is given back when the basket closes, which
   is what the copy under it says.

**Production** — sign in with Google and the app is the other one:

1. **Conectar billetera**. Pollar handles the login, and signing in is what
   crosses into production ([2.3](#23-preview-and-production)).
2. Build a basket the same way and press **Pagá con USDC**. The deposit screen
   now asks for a payment from *your* wallet, in real USDC, to
   `DEPOSIT_ADDRESS_MAINNET`, and takes one signature before it quotes.
3. The card that appears is yours and stays yours. A second basket tops the
   same card up — same last four digits, higher balance — and **/mis-compras**
   lists the orders and holds the one deliberate way to give the card back.

To prove the "exactly one card" promise rather than trust it, clear
localStorage between the two baskets. The mirror there is a convenience; the
binding is in Postgres, and that is what the second deposit must find.

### The escrow walkthrough — dormant

The original flow paid into a Soroban escrow contract and released it with
**Ya lo completé** / **No se pudo**. **Those contracts are still deployed on
testnet and nothing in the UI reaches them.** The rail in use is the plain
deposit above: a payment to a known address with a memo, confirmed off Horizon.

Kept here, and kept configured, because the decision to revive it or retire it
has not been made. If it is revived, `STELLAR_RESOLVER_SECRET*`,
`contracts.usdc.id` (the SEP-41 token) and `lib/settle-gate.ts` are where it
picks back up. The faucet (**Cargar USDC**) belongs to the same rail and is
likewise unreachable — no mode has a signed-in testnet wallet to press it with.

---

## Troubleshooting

**`STELLAR_RESOLVER_SECRET is for G…, but the deployed contracts expect G…`**
The key and `deployments.json` are from different deployments. Either re-run
step 1.5 against the current deployment, or `--force` a new one.

**`tx_no_source_account`** Something tried to submit from an address with no
account on the ledger. On testnet, friendbot it.

**Preview pays in XLM instead of USDC.** `contracts.usdc.issuer` is still
`null` for testnet, so `depositAssetFor` falls back to native. Run
[1.6](#16-issue-the-testnet-usdc-preview-pays-with) and regenerate the module.

**`DEMO_WALLET_SECRET is not set`, or a public-key mismatch.** The variable is
missing, or it holds a key that is not the account pinned as `demoWallet` in
`deployments.json`. The check is deliberate — it is what stops a mainnet secret
in that slot from ever signing.

**`prepared statement already exists`, on the second request.** `DATABASE_URL`
is pointed at the session port (5432) instead of the pooler (6543), or
`prepare: false` was dropped. See [2.5](#25-the-database).

**A signed-in shopper gets a second card.** The `card_owner` binding was not
found: check `DATABASE_URL` is set in Vercel and `npm run db:status` shows both
migrations applied. The routes answer 503 rather than mint a duplicate, so this
looks like a failure and not like a silent extra card.

**Contract ids stopped resolving.** Testnet is wiped periodically. Re-run
`npm run deploy:testnet -- --force` and commit the new ids.

**The install fails on Vercel.** Check the Node version is 22.x, not 20.

**`Module not found: Can't resolve '@changuito/mcp/server'` in the Vercel build.**
The MCP package compiles to `dist/`, which is gitignored, so a fresh checkout
has the sources and none of the output the `exports` map points at. Two things
build it now and you should not hit this: `prepare` in `packages/mcp` runs on
`npm install`, and `prebuild` in `apps/web` runs on `npm run build`. The second
exists because Vercel caches `node_modules` — on a cache hit the install can be
a no-op, and `dist/` lives in the source tree, not in the cache. If it somehow
still happens, set the Build Command override to
`npm run build -w @changuito/mcp && next build`.

**`[PollarClient] constructor() called server-side` in the build log.** Expected
and harmless — it is a `console.warn`, not a throw. The provider mounts during
SSR on purpose; making it client-only would trade this warning for a hydration
mismatch.

---

## Part 4 — www.changuito.me

The marketing site is a second Vercel project. It is `apps/landing`
(`@changuito/landing`), not a route inside `apps/web`. Do not point
`www.changuito.me` at the shopper project, and do not point `app.changuito.me`
at the landing.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | `apps/landing` |
| Install / build | defaults (install from the repo root, `next build` in this package) |
| Node.js version | **22.x** |
| Environment variables | none |

Details, including the manual install/build commands if Vercel does not detect
the workspace, are in [apps/landing/README.md](apps/landing/README.md). Locally:

```bash
npm run dev -w @changuito/landing     # http://localhost:3125
npm run build -w @changuito/landing
```
