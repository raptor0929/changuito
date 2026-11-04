# Testing strategy

How Changuito is tested in this repo (`tote-hq/stellar`), what runs where, and
how that maps to the Solana sibling (`tote-hq/solana`). Numbers and paths below
are from what is in the tree today, not from a future plan.

Parent task: [tote-hq/changuito-tareas#35](https://github.com/tote-hq/changuito-tareas/issues/35).

---

## Levels (ISTQB-aligned)

| Level | What it proves | What exists here |
|---|---|---|
| **Unit** | One module, no real network, no Docker | `node --experimental-strip-types --test` under `apps/web/lib/test`, `apps/landing/lib/test`, `packages/mcp`, `packages/trust`. Soroban: `cargo test` in `contracts/escrow` (19) and `contracts/mock_usdc` (15), against `soroban-sdk` testutils — in-process ledger, throwaway addresses |
| **Integration** | Two or more real components, still no production network | Redis stand-in via Testcontainers (`apps/web/lib/test/kv-stand-in.ts` + `turn-store.redis.test.ts`) for Vercel KV. Local chain node for the escrow is the next layer (see [Testcontainers vs Compose](#testcontainers-versus-docker-compose)) |
| **E2E** | The shopper path in a browser | Playwright under `e2e/`: `landing`, `app`, and `checkout` projects — documented in [e2e.md](e2e.md) |
| **Security / a11y (planned, not in CI yet)** | Abuse cases and WCAG AA | No OWASP ZAP or axe job in this repo today. Contrast and focus rules show up in unit copy/UI tests where they exist; a dedicated axe + ZAP lane is still open work |

The escrow money properties (balances sum, `BasketMismatch`, self-refund after
deadline) live in **unit** Rust today. Integration against a real node repeats
the happy paths and the mismatch so the deploy + RPC path is not only
`soroban-sdk` fantasy.

---

## Test design techniques in use

Named the ISTQB way, mapped to files that already exist:

| Technique | Where |
|---|---|
| **Equivalence partitioning** | Amount and timeout bounds in `contracts/escrow/src/test.rs` (`zero_and_negative_amounts_are_rejected`, `a_deadline_must_be_far_enough_out_to_mean_something`) |
| **Boundary value analysis** | `MIN_TIMEOUT` / `MAX_TIMEOUT`, zero and negative amounts, deadline exactly at `START + TIMEOUT` for buyer self-refund |
| **Decision / branch** | Settle vs refund vs closed-order; resolver vs buyer-after-deadline vs stranger |
| **State transition** | Open → Settled / Refunded; rejected reopen; settle-after-refund |
| **Error guessing / negative** | Wrong `basket_hash` → `BasketMismatch`; unauthorized settle/refund |
| **Pairwise-ish UI** | Playwright projects (guest vs auth, landing vs app); auth specs skip without credentials |

App-layer unit tests favour pure reducers and route handlers with fakes
(`lib/test/support/`), not a second copy of the contract rules.

---

## What runs locally vs in CI

| Suite | Local command | CI today |
|---|---|---|
| JS/TS unit (`mcp`, `trust`, `web`, `landing`) | `npm test` | `.github/workflows/unit.yml` on every `pull_request` and every push to `main` |
| Redis / turn-store integration | same `npm test` (skips if `docker info` fails) | Same unit workflow; needs Docker on the runner |
| Contract unit (Rust) | `npm run contracts:test` | Not a dedicated job yet — run by hand / before deploy |
| Playwright E2E | `npm run test:e2e` | `.github/workflows/e2e.yml` — merge to `main` when backend paths change, or `workflow_dispatch`. Not on every PR |
| Local Stellar node + escrow | planned: `npm run test:integration:escrow` (issue #37) | planned separate job (issue #39) |

Permissions on existing workflows are `contents: read`. Unit and E2E do not
deploy to Vercel or Cloudflare; deploys stay outside these workflows.

---

## Test data rules

Hard rules for every level:

1. **No real user data.** Fixtures use invented carts, postal codes like `1425`,
   and names like `e2e@example.com`. Playwright must not submit a real
   whitelist signup ([e2e.md](e2e.md)).
2. **No secrets in git.** `.gitignore` covers `.env*`, `.secrets/`,
   `*.keystore.json`, `.stellar/`. Identities for deploys live in the Stellar
   CLI config on a machine, never in the repo (`scripts/deploy.sh`).
3. **Throwaway keys in automated tests.** Generate at runtime; never commit
   seed phrases, `S…` secret keys, or keypair JSON.
4. **No mainnet in tests.** Contract and faucet evidence in the README is
   testnet. Integration nodes are local / standalone only.
5. **Public explorers are fine.** Contract ids and past testnet tx hashes in
   docs are public ledger data, not credentials.

If a test needs a credential that is not throwaway, it skips (see
`CHANGUTO_E2E_EMAIL` / `CHANGUTO_E2E_PASSWORD` in the auth Playwright project).

---

## Testcontainers versus docker compose

### What already uses Testcontainers

`apps/web/lib/test/kv-stand-in.ts` starts `redis:7-alpine` plus
`hiett/serverless-redis-http` on a disposable Docker network, exposes a dynamic
HTTP port, and returns an Upstash-shaped URL. `turn-store.redis.test.ts` skips
cleanly when Docker is missing. That is the right shape for **one short-lived
dependency with an app-level client**: dynamic ports, start/stop in `before` /
`after`, no YAML to keep in sync with the test.

Kubernetes (Testcontainers k3s) is **out of scope**: the shopper app is
serverless on Vercel, not a cluster.

### Chain nodes: `stellar/quickstart` and `solana-test-validator`

| Concern | Testcontainers | Docker Compose / host CLI |
|---|---|---|
| Startup | 30–60 s+ for quickstart; tying that to every Node `describe` is slow and flaky | One compose (or script) start per job; tests assume a ready RPC |
| Ports | Dynamic mapping fights `stellar` / `solana` CLI defaults and friendbot URLs | Fixed `8000` (Horizon + Soroban RPC) / `8899` keeps CLI config boring |
| Multi-process tools | Harder: CLI deploy, invoke, and the test process all need the same endpoint | Compose publishes known ports; scripts share `NETWORK=local` |
| Image / binary | quickstart is a container image — Testcontainers can run it | Compose is the usual SDF quickstart path; Solana often uses the **host** `solana-test-validator` binary (as in this machine’s toolchain), not only a container |
| Failure mode | A mid-suite container death is opaque inside node:test | Compose logs and `docker compose down -v` are operable in CI |

### Recommendation

| Dependency | Tool | Why |
|---|---|---|
| Redis / Upstash-shaped KV | **Testcontainers** (already) | Ephemeral, dynamic port, one client |
| `stellar/quickstart` local + Soroban RPC | **`stellar container start local`** (wraps `stellar/quickstart`) or Compose | Long boot, fixed ports (`8000`), CLI-driven deploy/invoke. Prefer the CLI wrapper so the image flags stay in SDF’s hands |
| Solana escrow program | **`solana-test-validator`** (host or compose), driven by npm/anchor scripts | Matches how `scripts/solana-init.mts` already talks to an RPC; program load via `--bpf-program` |

Do **not** put the chain node inside the same Testcontainers helper as Redis.
Different lifetime, different consumers, different failure cost.

Follow-ups: [#37](https://github.com/tote-hq/changuito-tareas/issues/37) (Stellar
quickstart integration), [#38](https://github.com/tote-hq/changuito-tareas/issues/38)
(Solana validator), [#39](https://github.com/tote-hq/changuito-tareas/issues/39)
(CI job split so a slow node does not block `npm test`).

---

## Sibling repo note (`tote-hq/solana`)

The Solana tree shares the same JS unit / Playwright shape. Differences that
matter for this strategy:

- No Testcontainers Redis helper there today: expiring state moved to Postgres
  `kv` / `quota` tables ([tech-stack.md](https://github.com/tote-hq/solana/blob/main/docs/tech-stack.md)).
- Anchor program has **no Rust test suite** yet (`Anchor.toml` `test = "true"`);
  smokes are `scripts/solana-init.mts` and `scripts/devnet-e2e.mts` against
  **devnet**, not a local validator.
- Extra CI: `.github/workflows/anchor.yml` (`cargo check` / `cargo test` on
  `anchor/` path changes) and `gitleaks.yml`.

This document is mirrored under `docs/testing-strategy.md` there so both public
repos tell the same story.
