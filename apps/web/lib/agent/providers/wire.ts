import type Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic's message shape translated to OpenAI's, and the streamed reply
 * translated back.
 *
 * This file is pure on purpose: no fetch, no client, no imports but a type.
 * The translation is where a provider seam actually goes wrong — a dropped
 * `tool_call_id`, a tool result attached to the wrong message — and those are
 * bugs you want a unit test to catch, not a supermarket search.
 *
 * Why OpenAI's shape rather than Ollama's native `/api/chat`: the native API
 * has a `think: false` parameter the OpenAI-compatible one lacks, which would
 * be genuinely useful for Qwen3's hybrid models. But the OpenAI shape is
 * spoken by LM Studio, vLLM, llama.cpp's server and every hosted gateway, so
 * the seam stays pointable at something else when the laptop is the problem.
 * A `/no_think` line in the system prompt buys back the thinking control.
 *
 * The direction of translation is deliberate. Anthropic's shape is canonical
 * everywhere else in this app: `turn-store.ts` persists it, and the loop
 * appends to it. That matters for failover — a turn can start on Ollama and
 * finish on Sonnet between hops, which is only legal because the history is
 * already in the shape Sonnet expects. Storing OpenAI-shaped history would
 * make mid-turn failover a migration.
 */

// ------------------------------------------------------------- OpenAI shapes

/**
 * Written out rather than imported from the OpenAI SDK, which this app does not
 * depend on and should not start depending on for four interfaces.
 */
export interface OpenAiTool {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiDelta {
  content?: string | null;
  /** Non-standard, but several servers emit it for visible reasoning. */
  reasoning_content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

/**
 * One `data:` frame from an OpenAI-compatible stream, minus what we ignore.
 *
 * Every field is optional because a server is free to send a keep-alive frame
 * with an empty `choices`, and reading `choices[0]` off one of those is a
 * crash rather than a missing delta.
 */
export interface OpenAiChunk {
  choices?: { delta?: OpenAiDelta; finish_reason?: string | null }[];
}

// ------------------------------------------------------------ tools, outbound

export function toolsToOpenAi(tools: Anthropic.ToolUnion[]): OpenAiTool[] {
  const out: OpenAiTool[] = [];
  for (const t of tools) {
    // Anthropic's server-side tools (`{ type: 'web_search_20250305' }`) have no
    // schema to send and no local implementation to call. Dropping them beats
    // forwarding a name the local model would hallucinate arguments for.
    if (!('input_schema' in t)) continue;
    out.push({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    });
  }
  return out;
}

// --------------------------------------------------------- messages, outbound

/** Tool results carry text or images; a `role: 'tool'` message carries a string. */
function flattenResult(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
    // An image in a tool result has nowhere to go in a string. Say so rather
    // than dropping it silently, so the model knows something existed.
    else parts.push('[image omitted]');
  }
  return parts.join('\n');
}

function flattenText(content: Anthropic.ContentBlockParam[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === 'text') parts.push(block.text);
  return parts.join('\n\n');
}

/**
 * The two formats disagree about where tool results live, and this is the whole
 * reason this file exists.
 *
 * Anthropic puts every result for a hop in *one* user message, as a list of
 * `tool_result` blocks keyed by `tool_use_id`. OpenAI wants *one message per
 * result*, `role: 'tool'`, keyed by `tool_call_id`, and they have to follow the
 * assistant message that requested them with nothing in between. So one message
 * in becomes several out, and the order is load-bearing rather than cosmetic.
 */
export function messagesToOpenAi(
  system: string,
  messages: Anthropic.MessageParam[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content } as OpenAiMessage);
      continue;
    }

    if (msg.role === 'assistant') {
      const calls: OpenAiToolCall[] = [];
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          calls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      // `thinking` blocks are dropped. They are Anthropic-specific, the local
      // model has its own reasoning, and replaying someone else's would be
      // putting words in its mouth.
      const text = flattenText(msg.content);
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }

    // A user message: results first, each as its own message, then any text.
    // Text after the results rather than before, because a user message that
    // carries both is the state banner riding along with tool output, and the
    // banner reads as the newest thing said.
    const results = msg.content.filter(
      (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
    );
    for (const r of results) {
      out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: flattenResult(r.content) });
    }
    const text = flattenText(msg.content);
    if (text) out.push({ role: 'user', content: text });
  }

  return out;
}

// ------------------------------------------------------------ reply, inbound

export interface PartialCall {
  id?: string;
  name: string;
  /** Accumulated JSON. Arrives in fragments and is not parseable until the end. */
  args: string;
}

/**
 * Accumulates a streamed reply into Anthropic content blocks.
 *
 * OpenAI streams tool calls in pieces keyed by `index`: the name arrives in one
 * chunk, then `arguments` in fragments that are only valid JSON once
 * concatenated. Parsing early gets you half an object, which is the failure the
 * loop already guards against for `max_tokens` — acting on half an instruction.
 */
export class ReplyAccumulator {
  private text = '';
  private thinking = '';
  private readonly calls = new Map<number, PartialCall>();
  private finish?: string;

  /** Returns the deltas to emit, so the caller owns what reaches the UI. */
  push(chunk: OpenAiChunk): { text?: string; thinking?: string } {
    const choice = chunk.choices?.[0];
    if (!choice) return {};
    const delta = choice.delta ?? {};
    if (choice.finish_reason) this.finish = choice.finish_reason;

    const out: { text?: string; thinking?: string } = {};

    if (delta.content) {
      this.text += delta.content;
      out.text = delta.content;
    }
    if (delta.reasoning_content) {
      this.thinking += delta.reasoning_content;
      out.thinking = delta.reasoning_content;
    }

    for (const frag of delta.tool_calls ?? []) {
      const existing = this.calls.get(frag.index) ?? { name: '', args: '' };
      this.calls.set(frag.index, {
        // Each field is only overwritten when the fragment actually carries it:
        // a later fragment with `arguments` alone must not blank the name.
        id: frag.id ?? existing.id,
        name: frag.function?.name ?? existing.name,
        args: existing.args + (frag.function?.arguments ?? ''),
      });
    }

    return out;
  }

  /**
   * `stop_reason` in Anthropic's vocabulary, since the loop switches on it.
   *
   * `finish_reason` is checked *after* the tool calls, not instead of them:
   * some servers send `stop` alongside tool calls, and believing that would
   * end the turn with the basket half-built.
   */
  stopReason(): Anthropic.Message['stop_reason'] {
    if (this.calls.size) return 'tool_use';
    if (this.finish === 'length') return 'max_tokens';
    return 'end_turn';
  }

  /**
   * Content blocks in the shape `turn.messages` holds and Sonnet would accept,
   * so a turn that started here can be finished by Anthropic.
   */
  content(): Anthropic.ContentBlockParam[] {
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (this.text) blocks.push({ type: 'text', text: this.text });

    // Sorted by index: a Map preserves insertion order, and fragments for
    // index 1 can arrive before index 0.
    const indices = [...this.calls.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const call = this.calls.get(i)!;
      blocks.push({
        type: 'tool_use',
        // Ollama sometimes omits the id entirely. A synthesized one is fine as
        // long as it is stable within the turn, because the only thing that
        // reads it is the `tool_result` we pair back to it ourselves.
        id: call.id || `call_${i}`,
        name: call.name,
        input: parseArgs(call.args),
      });
    }
    return blocks;
  }

  /** Whether anything has reached the user yet. Governs the silent-retry rule. */
  emittedAnything(): boolean {
    return this.text.length > 0;
  }
}

/**
 * Tool arguments, or an empty object.
 *
 * A local model producing invalid JSON is routine rather than exceptional, and
 * `{}` reaches the tool as a missing-argument error the model can read and
 * correct. Throwing here would kill a turn over a stray trailing comma.
 */
function parseArgs(args: string): unknown {
  const trimmed = args.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

/**
 * Split an SSE body into JSON chunks, returning the unparsed remainder.
 *
 * Same contract as `parseEvents` in `lib/protocol.ts` and for the same reason:
 * a frame can be split anywhere, including inside a JSON string, so the caller
 * must prepend `rest` to the next read.
 */
export function parseSseChunks(buffer: string): { chunks: OpenAiChunk[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const chunks: OpenAiChunk[] = [];

  for (const frame of frames) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        chunks.push(JSON.parse(payload) as OpenAiChunk);
      } catch {
        // Unparseable frame: drop it rather than killing the stream.
      }
    }
  }

  return { chunks, rest };
}
