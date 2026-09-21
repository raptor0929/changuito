import type Anthropic from '@anthropic-ai/sdk';

import { callMcpTool, mcpToolsToAnthropic } from '../mcp/bridge';
import type { Session } from '../mcp/session';
import type { UiEvent } from '../protocol';
import { CHANGUITO_PROMPT, stateBanner } from './prompt';
import { selectBrains } from './provider';
import type { HopResult } from './providers/types';
import {
  emptyCache,
  RENDER_TOOLS,
  RENDER_TOOL_NAMES,
  rememberStructured,
  runRenderTool,
  type RenderCache,
} from './render-tools';

/** A basket takes a handful of searches. Past this the model is stuck, not working. */
const MAX_HOPS = 12;

/**
 * The turn's share of `maxDuration = 300` on `/api/chat`, with room left to
 * write the closing events. A turn that runs the route out of time dies
 * without a `done`, and the browser holds no snapshot for the next one.
 */
const TURN_BUDGET_MS = 280_000;

/**
 * How far into a turn the local model may still be used.
 *
 * Past this the rest of the turn is hosted, even if the laptop is answering
 * fine. The reason is arithmetic rather than distrust: a basket can take twelve
 * hops, and a local model that has used half the budget on four of them will
 * not finish. Switching at the halfway mark gives the hosted model enough room
 * to complete the basket, which is what the user actually asked for.
 */
const LOCAL_DEADLINE_MS = 150_000;

/** One local hop. Generous — the first-byte deadline catches a dead machine. */
const LOCAL_HOP_MS = 60_000;

export interface Turn {
  messages: Anthropic.MessageParam[];
  cache: RenderCache;
}

export const newTurnState = (): Turn => ({ messages: [], cache: emptyCache() });

/**
 * One user message, start to finish.
 *
 * Written against a streaming API rather than a tool runner because every tool
 * call here has a visible consequence — a spinner, a product grid — and owning
 * the loop means owning where those are emitted.
 *
 * The model that answers is chosen per hop, not per turn. A turn can begin on a
 * local model and finish on the hosted one, which is legal only because
 * `turn.messages` stays in Anthropic's shape whichever answered — the whole
 * reason `providers/wire.ts` translates outward and not inward.
 */
export async function runTurn(
  session: Session,
  turn: Turn,
  userText: string,
  emit: (e: UiEvent) => void,
): Promise<{ brain: string }> {
  const t0 = Date.now();

  const brains = await selectBrains();
  let local = brains.local;

  if (brains.mode === 'ollama' && !local) {
    // The one mode that does not fall back. It exists so that "is the laptop
    // actually being used?" has an answer, which `auto` cannot give — `auto`
    // succeeds either way, by design.
    emit({
      t: 'error',
      message: `El modelo local no está disponible (${brains.denial}). Probá de nuevo o usá AGENT_PROVIDER=auto.`,
      recoverable: true,
    });
    return { brain: 'none' };
  }

  /** Every model that answered a hop, in order, for the `done` event. */
  const used: string[] = [];

  const mcpTools = await mcpToolsToAnthropic(session.client);
  const tools = [...mcpTools, ...RENDER_TOOLS];

  const location = session.state.getLocation();
  const cart = turn.cache.cart;

  turn.messages.push({
    role: 'user',
    content: [
      { type: 'text', text: userText },
      {
        type: 'text',
        text: stateBanner({
          retailer: location?.retailer,
          postalCode: location?.postalCode,
          cartLines: cart?.lines.length,
          cartTotal: cart?.total.display,
        }),
      },
    ],
  });

  // The server's own instructions, then ours. Cached: both are stable for the
  // whole conversation, and they sit ahead of the messages that are not.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${session.client.getInstructions() ?? ''}\n\n${CHANGUITO_PROMPT}`.trim(),
      cache_control: { type: 'ephemeral' },
    },
  ];

  /** Hand the lane back so the next visitor can have it, once. */
  const retireLocal = async (outcome: 'ok' | 'fail'): Promise<void> => {
    if (!local) return;
    const lease = local.lease;
    local = undefined;
    await lease.release(outcome);
  };

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const remaining = TURN_BUDGET_MS - (Date.now() - t0);
      if (remaining <= 0) {
        emit({ t: 'error', message: 'La búsqueda tardó demasiado. Probá pidiéndolo más simple.', recoverable: true });
        return { brain: used.join(' → ') || 'none' };
      }

      // Not a failure, so the breaker is not told about it: the machine did
      // nothing wrong, the turn just ran out of room for it.
      if (local && Date.now() - t0 > LOCAL_DEADLINE_MS) {
        console.log('[loop] local model out of budget — finishing on the hosted model');
        await retireLocal('ok');
      }

      // Per hop, not per turn. What cannot be retried is a *hop's* partial
      // text, because that is what would be said twice; everything before it
      // is already committed to `turn.messages` and reads the same whoever
      // wrote it. Thinking does not count — it is transient, and letting it
      // block the fallback would forfeit the common case, where a local model
      // reasons for a while and then dies.
      let sawText = false;
      const cb = {
        onText: (delta: string) => {
          sawText = true;
          emit({ t: 'text', delta });
        },
        onThinking: (delta: string) => emit({ t: 'thinking', delta }),
      };

      let msg: HopResult;
      for (;;) {
        const active = local?.provider ?? brains.remote;
        const budgetMs = local ? Math.min(LOCAL_HOP_MS, remaining) : remaining;

        try {
          msg = await active.hop({ system, tools, messages: turn.messages, budgetMs }, cb);
          if (used[used.length - 1] !== active.label) used.push(active.label);
          break;
        } catch (e) {
          // The hosted model failing is the end of the line: there is nothing
          // left to fall back to, and the route turns it into one message.
          if (active.kind === 'anthropic') throw e;

          console.warn(`[loop] local model failed: ${e instanceof Error ? e.message : e}`);
          await retireLocal('fail');

          if (sawText) {
            // Half a sentence is already on screen. Starting over would say it
            // twice, and there is no way to unsay the first half.
            emit({ t: 'error', message: 'Se cortó la respuesta. Probá de nuevo.', recoverable: true });
            return { brain: used.concat('interrupted').join(' → ') };
          }
          // Round again. `local` is gone, so this picks the hosted model,
          // which either answers or throws — the loop cannot spin.
        }
      }

      turn.messages.push({ role: 'assistant', content: msg.content });

      if (msg.stopReason === 'refusal') {
        emit({ t: 'error', message: 'No puedo responder eso.', recoverable: false });
        return { brain: used.join(' → ') };
      }

      const uses = msg.content.filter(
        (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use',
      );

      if (msg.stopReason === 'max_tokens') {
        // A tool input truncated mid-object can still parse. Running it would be
        // acting on half an instruction.
        emit({ t: 'error', message: 'La respuesta se cortó. Probá de nuevo.', recoverable: true });
        return { brain: used.join(' → ') };
      }
      if (msg.stopReason === 'pause_turn') continue;
      if (!uses.length) return { brain: used.join(' → ') }; // end_turn, or a reply with nothing to do

      // Every result goes back in one user message. Splitting them across
      // messages teaches the model not to call tools in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        // The trail is for work, not for drawing. An MCP call reaches a
        // supermarket and can take twenty seconds, so naming it explains the
        // wait and a ✗ explains a gap in the answer. A render tool only moves
        // data the user is already looking at: "mostrando el carrito ✓" sits
        // above the cart it is describing, and a ✗ reports a failure whose only
        // consequence is that the model tries again half a second later.
        const traced = !RENDER_TOOL_NAMES.has(use.name);
        if (traced) emit({ t: 'tool_start', id: use.id, name: use.name });
        const t = Date.now();

        let result: Anthropic.ToolResultBlockParam;
        if (RENDER_TOOL_NAMES.has(use.name)) {
          result = runRenderTool(turn.cache, use, emit);
        } else {
          const call = await callMcpTool(session.client, use);
          rememberStructured(turn.cache, call.structured);
          result = call.block;
        }

        if (traced) emit({ t: 'tool_end', id: use.id, ok: result.is_error !== true, ms: Date.now() - t });
        results.push(result);
      }

      turn.messages.push({ role: 'user', content: results });
    }

    emit({
      t: 'error',
      message: 'Me quedé dando vueltas sin llegar a un carrito. Probá pidiéndolo más simple.',
      recoverable: true,
    });
    return { brain: used.join(' → ') || 'none' };
  } finally {
    // A turn that got this far without the local model failing counts as a
    // success, which resets the breaker. The lane has to go back either way —
    // its TTL is a backstop, not the plan.
    await retireLocal('ok');
  }
}
