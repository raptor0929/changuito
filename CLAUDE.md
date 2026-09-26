# Working on the agent

changuito's agent is the part of this repo with the most decisions per line, and
most of those decisions were made by watching it get something wrong. This file
records what changed and why, so the next person to touch it does not undo a fix
that has no visible scar.

Everything the agent is lives under `apps/web/lib/agent`:

| File | Holds |
|---|---|
| `loop.ts` | the tool loop: hops, what reaches the UI, which model answers each hop |
| `prompt.ts` | the system prompt, and the per-turn state banner |
| `render-tools.ts` | the tools that draw, and the cache they draw from |
| `turn-store.ts` | where the conversation lives between requests |
| `provider.ts` | which model answers this turn, and what it falls back to |
| `providers/types.ts` | the one interface a model has to satisfy |
| `providers/anthropic.ts` | the hosted model — lifted out of `loop.ts` unchanged |
| `providers/ollama.ts` | a local model over an OpenAI-compatible endpoint |
| `providers/wire.ts` | Anthropic ↔ OpenAI message translation. Pure, and tested |
| `providers/gate.ts` | is the local model up, healthy and free — breaker and lanes |

`apps/web/CLAUDE.md` is not this file's sibling in spirit — it is a one-line
pointer to `AGENTS.md`, which `next dev` writes and re-adds on every run. Leave
both alone; edits there come back.

---

## The shape it started with, and the five things that changed it

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

### 2. The cart draws itself, and §1 does not apply to it

*First the bug: two cart cards in one reply, the first without a link. Then the
opposite bug, which the fix for the first one caused.*

`render_cart` used to be called twice on purpose — once when the basket was
built, once after `get_cart_link` so the card carried the link. Both appended,
so the user read a cart, then the same cart again. It looks like the order went
through twice, which is an alarming thing to show someone mid-payment. So the
prompt and the tool description were tightened to *once*, and `chat-state.ts`
learned to dedupe as well, because a prompt is a request and not a guarantee.

Once cost the shopper the other half. Asked to change something, the model
changed it and then pointed at the card already on screen — the old lines, the
old total, "usá el mismo link". Which was **true**: `handoffUrl` is derived from
the cart id (`?orderFormId=…#/cart`) and does not move when lines change. And
useless, because the products and the amount above the pay button were the ones
from before.

**The cart is not the kind of thing §1 is about.** §1 is a set of twelve search
results and three recommendations — *which* to surface is a decision, so it is a
call. There is exactly one cart, the user built it, and its current contents are
not a choice anybody is making. Making the model ask to show them meant the
screen was right only when it remembered to.

So the basket draws itself. `autoRenderCart` in `render-tools.ts` runs from the
loop after **every** tool, and emits a `cart` event when the basket's
fingerprint has changed since the last card. Four parts hold it up:

- **The tools that change the cart now say so.** `add_to_cart` and
  `update_cart_item` returned text only — no `outputSchema`, no
  `structuredContent` — so `RenderCache.cart` went stale on the one call that
  made it stale, and even an explicit `render_cart` would have drawn the old
  lines. They declare `CartOutput` and return the cart they produced. If you add
  a tool that touches the basket, it reports the basket.
- **The fingerprint is the card, not the total.** `cardPrint` covers the cart id,
  the total, the link and every line's index, sku, quantity, line total and
  availability. A swap for another item at the same price changes the card and
  not the total.
- **Nothing is drawn without a link that opens *this* cart.** `handoffFor`
  records which cartId `handoffUrl` belongs to, at `get_cart_link`, the one
  moment the pairing is known. A card whose only actionable control is missing
  is the first bug again; a link carried onto a different basket opens somebody
  else's.
- **`drawn` and `handoffFor` ride in `turn-store.ts` as optional fields**, not a
  `v: 2`. A version bump resets every conversation in flight at deploy time,
  which is a worse trade than one redundant card.

`render_cart` survives for the one job left to it: bringing an *unchanged*
basket back after a question about it. Its description says so, and says never
to answer a change by pointing at a card already on screen. When the description
and the prompt disagree the description wins, so they must not disagree.

`chat-state.ts`'s dedupe is now load-bearing rather than a backstop, because the
automatic render is what mostly draws. Its rule: a `cart` event for a cartId
already shown **in the current turn** replaces that block in place, keeping its
`id` (React keys off it, and a fresh id unmounts and re-animates the card —
which looks exactly like the duplicate it replaced) and never dropping a
`handoffUrl` it already had.

Scoped to the current turn deliberately. A cart shown three messages ago is a
record of what the basket was *then*; merging across turns would rewrite history
the user has already scrolled past. `lib/test/chat-state.test.ts` pins that, and
`lib/test/render-tools.test.ts` pins the automatic render — including the cases
where it must *not* fire.

**Product grids are the other half of the same complaint** and got the opposite
treatment, because §1 does apply to them. The images only ever appeared for the
first search: nothing asked for a `render_products` after a second one, so a
shopper who said "mostrame más" got names in prose and had to ask for the
pictures. The lever there is the prompt and the tool description, since
auto-rendering search results would surface twelve items the model did not
recommend. Both now require a call for **every** search whose results the model
mentions — a later page, another brand, a replacement for something out of
stock.

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

**A reload starts a new chat, and the old one is still there.** The rule that
got us here was: persisting the session id *without* rehydrating the transcript
is worse than either end state — an empty page backed by a server that
remembers — so do both halves or neither. Both halves are now done.
`chat-store.ts` holds the blocks and the session id in localStorage, the rail
lists them, and `use-chat.ts`'s `resume` puts one back with `seedIds` so the
restored blocks do not collide with new ones. A chat the server can no longer
continue comes back **read-only** rather than pretending, which is what
`isResumable` is for. Do not re-add the id to storage on its own.

**Three stores hold a conversation, and they are not redundant.** Redis
(`turn-store.ts`) is the working store the hop loop reads up to twelve times a
turn, at a one hour TTL. localStorage (`chat-store.ts`) is what the shopper
sees. Postgres (`chat-archive.ts` → the `chat` table) is the record: it outlives
the TTL, survives a cleared browser, and is what an order is joined back to.

The archive is one write per turn, in the same place and under the same rule as
the Redis one — **only after a clean return** — and it matters more there: a
transcript archived with an assistant `tool_use` that has no matching
`tool_result` is a permanent copy of a pairing the API rejects. It is also
**only for a signed-in wallet**. `chat.address` is `not null` and that is the
enforcement rather than an oversight: a transcript is a list of what somebody
bought and usually carries their postal code, so moving it from an hour in a
cache to durable storage is a real change in exposure. Reads are narrowed the
same way, in the `WHERE` clause — a chat id is a UUID, not a capability.

### 5. The model is chosen per hop, not per turn

*Today. The requirement: serve inference from a Mac at home, and never let a
visitor notice when it is asleep.*

`loop.ts` used to hold `new Anthropic()` and a model name. It now takes a
`Provider` — one method, `hop()`, taking Anthropic-shaped messages and
streaming deltas back. `providers/anthropic.ts` is the old code lifted out
without a change, so the path carrying real traffic is provably the same one.

**The load-bearing decision is that `turn.messages` stays Anthropic-shaped
whoever answered.** `providers/wire.ts` translates outward to OpenAI's format
on the way to a local model and back to content blocks on the way in; nothing
in the OpenAI shape is ever stored. That is what makes a turn able to start on
a laptop and finish on Sonnet, which is the case that actually matters — a
basket takes up to twelve hops and a local model will not always survive all
of them. It also means `turn-store.ts`'s `v: 1` codec needed no version bump.

Translation is where a seam like this goes wrong, so it is pure and has its own
tests. The two formats disagree about tool results in a way that is easy to get
subtly wrong: Anthropic puts every result for a hop in **one** user message
keyed by `tool_use_id`, OpenAI wants **one message per result**, `role: 'tool'`,
keyed by `tool_call_id`, immediately after the assistant message that asked.
An unmatched id is rejected on the *next* request — a turn later, on a turn
that did nothing wrong, which is the same delayed-blame shape as the history
bug in §4.

**The fallback is per hop, and the rule is first-byte.** What cannot be retried
is a *hop's* partial text, because that is the text that would be said twice;
everything before it is already committed to `turn.messages` and reads the same
whoever wrote it. So a local model that fails before emitting text is replaced
silently and the hop is re-run. After text is on screen, the user gets a
visible error instead — half a sentence cannot be unsaid. Thinking deltas
deliberately do not count: they are transient, and letting them block the
fallback would forfeit the common case, where a local model reasons for a while
and then dies.

Four gates decide whether the local model is used at all, and they are four
because they catch four different failures:

| Gate | Catches | Cost when it fires |
|---|---|---|
| probe of `/api/tags` | asleep, tunnel down, token wrong, model not pulled | ≤2s, shared for 30s |
| circuit breaker | a machine that keeps failing | nothing after the third failure |
| lane lease | another visitor mid-basket | nothing — `busy` is instant |
| first-byte deadline | reachable, but paging 5GB off a full SSD | 8s |

**The breaker and the lanes live in Redis, not module scope**, for exactly the
reason in §4: per-instance state means every cold lambda rediscovers the laptop
is asleep by paying the full timeout, and the visitor pays it too. One shared
breaker means the first request absorbs that and the rest are told
immediately.

Two things worth knowing before changing any of it:

- **The default is one lane.** A 16GB machine runs one model instance, so
  raising it buys a queue rather than parallelism — and a queued visitor waits
  behind a stranger's groceries when the hosted model would have answered them
  in a second. Overflowing to the *faster* model is a comfortable kind of
  degradation. Do not "fix" this by adding a queue.
- **`num_ctx` cannot be set per request.** Ollama's OpenAI-compatible endpoint
  ignores it, the server default is 4096, and it truncates silently. With
  twelve tool schemas that cuts the tool definitions themselves and the model
  starts inventing tool names. It has to be `OLLAMA_CONTEXT_LENGTH` on the
  server — see DEPLOY.md Part 3. An empty reply from a local model is treated
  as a failure partly because this is its usual cause.

`AGENT_PROVIDER=ollama` refuses to fall back and shows the reason. It exists
because `auto` cannot answer "is the machine actually being used?" — `auto`
succeeds either way, which is the whole point of it.

### 6. The wait says what it is waiting for

*QA on production: a guest sat on "Buscando…" for ~35s and got "No se
envió"; a signed-in shopper waited 38–60s with nothing but Parar on screen.*

Two problems with one cause: before the first model output, the browser had
no evidence the server was doing anything. A local hop can reason for half a
minute without a text delta, and the first byte of the body was the 15s
heartbeat. So the UI could not tell a slow turn from a dead one, and when the
stream did die it blamed the user's message.

Now there is a `status` event, and it never creates a block:

- **`received`** is the first byte of the body, written before the MCP boot
  and the model. It is also what `failTurn` reads: a turn that failed with
  nothing on screen *after* `received` is `dropped` ("Se cortó antes de
  responder"), not `network` ("No se envió"). The retry control is the same
  — history is still only written on a clean return — but the copy is true.
- **`thinking`** at the top of every hop, with its index. Hop 0 is reading
  the user; later hops are reading tool results.
- **`fallback`** when the local model failed before any text and the hop is
  being re-run on the hosted one.

`lib/turn-progress.ts` turns that, plus pending tools and the clock, into the
line under the composer. **Nothing in it is estimated.** Every stage is
something that happened, and the reassurance copy keys off elapsed time,
which is also something that happened. Do not add a progress bar: the server
does not know how many hops a basket will take, so a bar would be a promise
it cannot keep.

Local reasoning deltas are still not forwarded. Ollama sends them as
`delta.reasoning`, which `wire.ts` ignores on purpose: it is long, raw and
English, and the `thinking` stage already says the model is working.

The failure detail (`El servidor respondió 504.`, `Se cortó la conexión…`)
is now printed under an undelivered bubble. It used to be discarded, which is
why the QA report could say *that* it failed and not *how*.

### 7. The first question is not a model call

*Same QA pass. Reproduced on production as a guest: the starter chip took
41.7s to come back with "¿cuál es tu código postal?", and the basket after it
178s, on the local model.*

The prompt requires a store and a postal code before anything else, so the
first reply to a starter chip is always the same question — and on a local
model it cost a full hop of prompt evaluation over twelve tool schemas.
`agent/early-ask.ts` answers it in-process when **all three** hold: it is the
first message of the conversation, no location is set, and nothing in the
text looks like a postal code. The question and the user's message go into
`turn.messages` like any other exchange, so the next hop reads the original
request, the question, and the answer in order.

Keep it that narrow. A follow-up ("no sé", "¿qué es un CPA?") deserves a
model; a false negative on the postal-code regex only means the model gets
the message, which is what used to happen to every message.

---

## Things that are the way they are on purpose

- **`MAX_HOPS = 12`.** A basket takes a handful of searches. Past this the model
  is stuck, not working, and the user gets a plain message saying so.
- **`claude-sonnet-5`** is both the default and the fallback, overridable with
  `AGENT_MODEL`. It stays the default even where a local model is configured,
  because a Vercel lambda has no Ollama and the deployment has to work without
  one. Haiku 4.5 runs — the loop switches to a fixed thinking budget for it,
  because adaptive thinking and the effort control are Claude 5 features and
  Haiku rejects the request outright — but in the one run measured here it
  stopped after the product search without building the cart. Swapping the
  model is not a one-line change; the request shape follows.
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
npm test -w @changuito/web      # 107 tests, node:test with --experimental-strip-types
npm run typecheck -w @changuito/web
npm run build
```

Two constraints that bite in this repo specifically:

- **`target: ES2022`** in `apps/web/tsconfig.json`. `findLastIndex` and friends
  are ES2023 and will not typecheck — `chat-state.ts` has a hand-written
  `lastIndexWhere` for exactly this reason.
- **`--experimental-strip-types` erases types; it does not compile.** Two
  separate consequences, and both have bitten here:

  *It cannot resolve extensionless imports.* A test that imports a module which
  imports `'../mcp/bridge'` fails at load. This is why `turn-store.ts` depends
  on `loop.ts` with `import type` only — type imports are erased, so they cost
  nothing at runtime — why `providers/wire.ts` and `providers/gate.ts` have no
  relative imports at all, and why `providers/ollama.ts` spells its own as
  `'./wire.ts'`. A package import resolves fine; a relative one does not.

  *It rejects any syntax that emits code.* A parameter property —
  `constructor(readonly stage: string)` — is a field assignment in disguise, so
  strip-only mode refuses the file with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
  `ProviderFailure` declares its field and assigns it in the body for exactly
  this reason. The same goes for `enum` and namespaces. If a test dies at load
  with that code, this is why.
