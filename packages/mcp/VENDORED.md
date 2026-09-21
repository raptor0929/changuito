# Vendored: `supermercado-mcp`

This package is a copy of the MCP server from `supermarket-mcp-research/`, brought into this
repository so that `changuito` is self-contained and deployable from GitHub to Vercel without a
submodule or a published package.

## What changed on the way in

| Change | Why |
|---|---|
| `name` → `@changuito/mcp` | workspace resolution |
| `playwright`, `ethers` → `optionalDependencies` | they belong to the checkout half, which the web app never loads. Vercel installs with `--omit=optional`, so neither reaches the lambda. |
| nested `package-lock.json` removed | workspaces resolve from the root lockfile |
| `createSupermercadoServer()` factory added | the web app connects an MCP `Client` over an in-memory transport instead of spawning a process |
| checkout tools became a lazy `await import()` | keeps Playwright out of the read-only import graph |

Nothing else was touched. The 492 unit tests that came with it are unmodified and
still pass; 28 more were added here to cover the factory, the session state it
takes, and a cart total that turned out to be the pre-discount subtotal. 520 run
with `npm test -w @changuito/mcp`.

## What this package can and cannot do here

The **read-only half** (search, price check, cart building, handoff links) is plain HTTPS against
the retailers' public storefront APIs. It runs anywhere, including a serverless function.

The **checkout half** (`link_marketplace_account`, `build_cart`, `approve_payment`, …) opens a
headed browser *on the host* so a human can type their supermarket password, and it needs
Playwright plus real payment credentials. It cannot run on Vercel and this app does not try. See
`SETUP.md` for running that half locally.
