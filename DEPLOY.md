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

---

## Part 2 — the app on Vercel

### 2.1 Get the two API keys

- **Anthropic** — [console.anthropic.com](https://console.anthropic.com) → API
  keys. This is what runs the shopping agent.
- **Pollar** — the [Pollar dashboard](https://pollar.xyz) → your application →
  API key, with the network set to **testnet**. This one is publishable and
  ships in the browser bundle by design.

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

### 2.3 Environment variables

Add these under **Settings → Environment Variables**, for Production *and*
Preview:

| Name | Value | Exposed to |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | server only |
| `NEXT_PUBLIC_POLLAR_API_KEY` | your Pollar key | the browser, by design |
| `STELLAR_RESOLVER_SECRET` | the `S…` from step 1.5 | server only |
| `FX_ARS_PER_USD` | optional, e.g. `1500` | server only |
| `KV_REST_API_URL` | set by the Redis integration | server only |
| `KV_REST_API_TOKEN` | set by the Redis integration | server only |

The two `KV_` ones you do not type — see [2.4](#24-conversation-history) below.

`FX_ARS_PER_USD` pins the exchange rate. Set it if you want a demo to quote the
same number every time; leave it unset and the app uses the live rate.

Only the `NEXT_PUBLIC_` one reaches the browser. Do not add the prefix to
either of the others — Next inlines anything with it into the client bundle at
build time, and `STELLAR_RESOLVER_SECRET` is a key that can mint tokens and
move escrowed funds.

### 2.4 Conversation history

Skippable, and the deploy works without it — but skip it and the agent will
forget mid-conversation, which is a bad thing to discover during a demo.

The problem is that a lambda's module scope is a cache, not a database.
Instances are recycled on deploy, on idle and on scale-out, so the message
after a cold start reaches a process that has never heard of you. The page
still shows every bubble, so the agent looks like it stopped paying attention
rather than like it restarted.

1. **Storage → Create Database → Marketplace → Upstash for Redis.**
2. Region: match your functions (Vercel's default is `iad1`, Washington D.C.).
   Leave Read Regions empty.
3. **Turn Eviction on.** Off means writes *fail* once the database is full.
   This is a cache — dropping the oldest session is the right answer, and you
   will not come close to the free tier's 256 MB anyway. A conversation is
   roughly 100 KB and expires after an hour.
4. **Connect Project.** That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   (plus some it does not use), and that is all the app needs.

Use the REST pair, not `REDIS_URL` or `KV_URL`. Those are `rediss://` strings
for a TCP client, and one TCP connection per lambda is the connection-limit
problem an HTTP client exists to avoid.

For local dev, copy the two values into `apps/web/.env`. Leave them out and the
app falls back to an in-process Map, which on one machine is the same guarantee
for free.

This does **not** survive a page reload: the browser mints a new session id
each load, so a reload is a fresh start by design — the chat looks empty and
the agent is empty, which at least agree with each other.

### 2.5 Deploy a preview first

Push to a branch, let Vercel build it, and check three things on the preview
URL before promoting.

The chain reads work:

```bash
curl "https://<preview>/api/balance?address=<your G-address>"
```

The rate comes back:

```bash
curl "https://<preview>/api/quote?centavos=1234500"
```

And the chat **streams** rather than arriving in one lump. If it arrives all at
once something is buffering the SSE response — the route sets
`X-Accel-Buffering: no` for exactly this, and the runtime must be `nodejs`,
never edge.

Then **Promote to Production**.

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

1. Open the site and click **Conectar billetera**. Pollar handles the login.
2. Click **Fondear**. It creates your testnet account with friendbot if it does
   not exist yet, then mints 50 demo USDC. There is a 60-second cooldown and it
   declines above 100 USDC.
3. Ask for a basket — *"armá un desayuno para dos por menos de $10.000"*.
4. When the cart card appears, click **Confirmar y pagar en USDC**. Check the
   totals, then sign. Your funds are now in the escrow contract.
5. Open the store link and complete the basket there.
6. Back in changuito, click **Ya lo completé** to release the money, or **No se
   pudo** to get it back. Both link to the transaction on stellar.expert.

---

## Troubleshooting

**`STELLAR_RESOLVER_SECRET is for G…, but the deployed contracts expect G…`**
The key and `deployments.json` are from different deployments. Either re-run
step 1.5 against the current deployment, or `--force` a new one.

**The faucet says the account could not be created.** Friendbot rate-limits.
Wait a minute and try again.

**`tx_no_source_account`** Something tried to submit from an address with no
account on the ledger. Fund it first — the faucet button does this for the
user's wallet.

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
