# Working on the agent

changuito's agent is the part of this repo with the most decisions per line, and
most of those decisions were made by watching it get something wrong. This file
records what changed and why, so the next person to touch it does not undo a fix
that has no visible scar.

Everything the agent is lives in four files:

| File | Holds |
|---|---|
| `apps/web/lib/agent/loop.ts` | the tool loop: streaming, hops, what reaches the UI |
| `apps/web/lib/agent/prompt.ts` | the system prompt, and the per-turn state banner |
| `apps/web/lib/agent/render-tools.ts` | the tools that draw, and the cache they draw from |
| `apps/web/lib/agent/turn-store.ts` | where the conversation lives between requests |

`apps/web/CLAUDE.md` is not this file's sibling in spirit — it is a one-line
pointer to `AGENTS.md`, which `next dev` writes and re-adds on every run. Leave
both alone; edits there come back.

---

## The shape it started with, and the four things that changed it

### 1. The model was given tools for drawing, not just for shopping

*`47f9704`, refined since.*

The first loop handed MCP results to the UI directly: a `search_products` call
returned twelve items, so the grid showed twelve items. That is the wrong unit.
A search result is data — it is the same twelve whether the model recommends
three of them or none — and *which ones to surface* is a decision. Decisions
have to be calls, or the UI is guessing.

So `render_products` and `render_cart` exist alongside the MCP tools. They never
reach the MCP server; `runRenderTool` handles them in-process and emits a UI
event.

**The rule that makes this safe: render tools take identifiers only.** Never a
price, never a name. The model picks SKUs, and the server looks those up in
`RenderCache` to fill in what they cost. A model that hallucinates a price
cannot get that price onto the screen, because there is no argument for it to
put it in. That matters most directly above a button that spends money.

If you add a render tool, keep the property. The moment an input carries a
value rather than a reference, the grid can be wrong.

### 2. The cart is drawn once per turn

*Today. The bug: two cart cards in one reply, the first without a link.*

`render_cart` used to be called twice on purpose — once when the basket was
built, once after `get_cart_link` so the card carried the link. Both appended,
so the user read a cart, then the same cart again. It looks like the order went
through twice, which is an alarming thing to show someone mid-payment.

Fixed in three places at once, because one alone would have been a patch:

- **`prompt.ts`** now orders the flow `add_to_cart` → `get_cart_link` →
  `render_cart` *once*. Rendering before the link exists draws a card the user
  cannot act on.
- **`render-tools.ts`**'s `render_cart` description used to say "call this after
  any change to the cart", which actively asked for the second call. It now says
  the same thing as the prompt. When these two disagree the tool description
  wins, so they must not disagree.
- **`chat-state.ts`** dedupes anyway. A prompt is a request, not a guarantee —
  the model will render twice again eventually, and the UI should survive it.

The reducer's rule: a `cart` event for a cartId already shown **in the current
turn** replaces that block in place, keeping its `id` (React keys off it, and a
fresh id unmounts and re-animates the card — which looks exactly like the
duplicate it replaced) and never dropping a `handoffUrl` it already had.

Scoped to the current turn deliberately. A cart shown three messages ago is a
record of what the basket was *then*; merging across turns would rewrite history
the user has already scrolled past. `lib/test/chat-state.test.ts` pins all of
this, including the not-merging case.

### 3. The tool trail shows work, not drawing

*Today, same bug.*

`tool_start` / `tool_end` used to fire for every tool. So a failed `render_cart`
— which happens when the model renders before a cart exists, recovers, and
retries half a second later — put a red ✗ **mostrando el carrito** in front of
the user, reporting a failure with no consequence.

Now `loop.ts` traces MCP tools only. The distinction is whether the user is
owed an explanation: an MCP call reaches a supermarket and can take twenty
seconds, so naming it explains the wait and a ✗ explains a gap in the answer. A
render tool only moves data the user is already looking at.

Failed MCP tools stay visible. Do not "clean up" the trail by hiding those.

### 4. Conversation history outlives the process

*`c88332d`.*

History used to be a module-scope `Map`. On one developer's machine that is
correct and free. On Vercel it is not: module scope is a cache, not a database,
and a cold start, a deploy or a scale-out mid-basket wipes it. The symptom was
the agent re-asking a question the user had already answered while the page
still showed every bubble — the user sees continuity the server does not have,
which is the worst shape a bug can take.

`turn-store.ts` puts it in Redis (Upstash REST) keyed by session, with a one
hour TTL, and **falls back to the in-process Map when no credentials are set**
so a fresh clone still runs.

Three things to know before editing it:

- **`RenderCache.products` is a `Map`, and `JSON.stringify` renders a Map as
  `{}`** — silently, no error. `encodeTurn` / `decodeTurn` convert explicitly in
  both directions. Never replace them with a spread.
- **Failures degrade, they do not throw.** A read that fails starts a fresh
  turn; a write that fails logs and leaves the old value to expire. Losing
  history is survivable; a 500 in the middle of a shop is not.
- **The write happens only after a clean return.** A turn that threw mid-hop can
  leave an assistant `tool_use` with no matching `tool_result`, and the API
  rejects that pairing on the *next* request — so the failure would surface one
  message later, on a turn that did nothing wrong.

Note the split with `lib/mcp/session.ts`, which solves the same problem the
opposite way: MCP state rides in a **snapshot the browser holds and sends back**,
because it is a postal code and a cart id — things the user already has. History
is the conversation itself and grows every hop, so it goes server-side.

**Reload is still a fresh start, by design.** `use-chat.ts` mints the session id
with `crypto.randomUUID()` into a `useRef` and nothing persists it, so a refresh
cannot find its own history. Persisting the id *without* rehydrating the
transcript would be worse than either end state: an empty page backed by a
server that remembers. If you want reload persistence, do both halves.

---

## Things that are the way they are on purpose

- **`MAX_HOPS = 12`.** A basket takes a handful of searches. Past this the model
  is stuck, not working, and the user gets a plain message saying so.
- **`claude-sonnet-5`**, overridable with `AGENT_MODEL`. Haiku 4.5 runs — the
  loop switches to a fixed thinking budget for it, because adaptive thinking and
  the effort control are Claude 5 features and Haiku rejects the request outright
  — but in the one run measured here it stopped after the product search without
  building the cart. Swapping the model is not a one-line change; the request
  shape follows.
- **The system prompt is `SERVER_INSTRUCTIONS` from the MCP package, then ours,
  cached.** The server is the authority on how to drive the server; a
  paraphrase would drift. Per-turn state goes in the *user* message via
  `stateBanner`, not the system prompt — anything that changes in the system
  prompt invalidates the cache for the whole conversation.
- **The loop is written against `messages.stream()`, not the tool runner.**
  Every tool call here has a visible consequence, and owning the loop means
  owning where those are emitted.
- **`chat-state.ts` is pure and framework-free**, so the ordering rules are
  testable without a browser. The hard part is ordering: a grid arrives
  mid-sentence, and appending it at the end of the turn makes the sentence that
  introduced it read as its caption.

## Before you commit

```
npm test -w @changuito/web      # 67 tests, node:test with --experimental-strip-types
npm run typecheck -w @changuito/web
npm run build
```

Two constraints that bite in this repo specifically:

- **`target: ES2022`** in `apps/web/tsconfig.json`. `findLastIndex` and friends
  are ES2023 and will not typecheck — `chat-state.ts` has a hand-written
  `lastIndexWhere` for exactly this reason.
- **`--experimental-strip-types` cannot resolve extensionless imports.** A test
  that imports a module which imports `'../mcp/bridge'` fails at load. This is
  why `turn-store.ts` depends on `loop.ts` with `import type` only — type
  imports are erased, so they cost nothing at runtime.
