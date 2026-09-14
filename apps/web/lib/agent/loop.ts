import Anthropic from '@anthropic-ai/sdk';

import { callMcpTool, mcpToolsToAnthropic } from '../mcp/bridge';
import type { Session } from '../mcp/session';
import type { UiEvent } from '../protocol';
import { CHANGUITO_PROMPT, stateBanner } from './prompt';
import {
  emptyCache,
  RENDER_TOOLS,
  RENDER_TOOL_NAMES,
  rememberStructured,
  runRenderTool,
  type RenderCache,
} from './render-tools';

const MODEL = 'claude-sonnet-5';

/** A basket takes a handful of searches. Past this the model is stuck, not working. */
const MAX_HOPS = 12;

export interface Turn {
  messages: Anthropic.MessageParam[];
  cache: RenderCache;
}

export const newTurnState = (): Turn => ({ messages: [], cache: emptyCache() });

/**
 * One user message, start to finish.
 *
 * Written against `messages.stream()` rather than the tool runner because
 * every tool call here has a visible consequence — a spinner, a product grid —
 * and owning the loop means owning where those are emitted.
 */
export async function runTurn(
  session: Session,
  turn: Turn,
  userText: string,
  emit: (e: UiEvent) => void,
): Promise<void> {
  const anthropic = new Anthropic();

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

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      system,
      tools,
      messages: turn.messages,
    });

    stream.on('text', (delta) => emit({ t: 'text', delta }));
    stream.on('thinking', (delta) => emit({ t: 'thinking', delta }));

    const msg = await stream.finalMessage();
    turn.messages.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'refusal') {
      emit({ t: 'error', message: 'No puedo responder eso.', recoverable: false });
      return;
    }

    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (msg.stop_reason === 'max_tokens') {
      // A tool input truncated mid-object can still parse. Running it would be
      // acting on half an instruction.
      emit({ t: 'error', message: 'La respuesta se cortó. Probá de nuevo.', recoverable: true });
      return;
    }
    if (msg.stop_reason === 'pause_turn') continue;
    if (!uses.length) return; // end_turn, or a reply with nothing to do

    // Every result goes back in one user message. Splitting them across
    // messages teaches the model not to call tools in parallel.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      emit({ t: 'tool_start', id: use.id, name: use.name });
      const t0 = Date.now();

      let result: Anthropic.ToolResultBlockParam;
      if (RENDER_TOOL_NAMES.has(use.name)) {
        result = runRenderTool(turn.cache, use, emit);
      } else {
        const call = await callMcpTool(session.client, use);
        rememberStructured(turn.cache, call.structured);
        result = call.block;
      }

      emit({ t: 'tool_end', id: use.id, ok: result.is_error !== true, ms: Date.now() - t0 });
      results.push(result);
    }

    turn.messages.push({ role: 'user', content: results });
  }

  emit({
    t: 'error',
    message: 'Me quedé dando vueltas sin llegar a un carrito. Probá pidiéndolo más simple.',
    recoverable: true,
  });
}
