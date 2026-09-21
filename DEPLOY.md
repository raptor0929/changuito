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

`FX_ARS_PER_USD` pins the exchange rate. Set it if you want a demo to quote the
same number every time; leave it unset and the app uses the live rate.

Only the `NEXT_PUBLIC_` one reaches the browser. Do not add the prefix to
either of the others — Next inlines anything with it into the client bundle at
build time, and `STELLAR_RESOLVER_SECRET` is a key that can mint tokens and
move escrowed funds.

### 2.4 Deploy a preview first

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
