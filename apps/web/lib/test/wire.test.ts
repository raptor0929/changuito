import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import {
  messagesToOpenAi,
  parseSseChunks,
  ReplyAccumulator,
  toolsToOpenAi,
  type OpenAiChunk,
  type OpenAiDelta,
} from '../agent/providers/wire.ts';

// A streamed reply, one chunk at a time, the way a server sends it.
const chunk = (delta: OpenAiDelta, finish?: string): OpenAiChunk => ({
  choices: [{ delta, finish_reason: finish ?? null }],
});

const feed = (chunks: OpenAiChunk[]): ReplyAccumulator => {
  const acc = new ReplyAccumulator();
  for (const c of chunks) acc.push(c);
  return acc;
};

// ------------------------------------------------------------------ the tools

test('carries a tool schema across to the parameters field', () => {
  const tools: Anthropic.ToolUnion[] = [
    {
      name: 'search_products',
      description: 'Search a retailer',
      input_schema: { type: 'object', properties: { q: { type: 'string' } } },
    },
  ];

  assert.deepEqual(toolsToOpenAi(tools), [
    {
      type: 'function',
      function: {
        name: 'search_products',
        description: 'Search a retailer',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    },
  ]);
});

test('drops server-side tools, which have no schema to send', () => {
  // Forwarding the name alone would invite the local model to call something
  // that does not exist here.
  const tools = [
    { type: 'web_search_20250305', name: 'web_search' },
    { name: 'view_cart', input_schema: { type: 'object' } },
  ] as unknown as Anthropic.ToolUnion[];

  const out = toolsToOpenAi(tools);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.function.name, 'view_cart');
});

// --------------------------------------------------------------- the messages

test('puts the system prompt first, as its own message', () => {
  const out = messagesToOpenAi('be helpful', [{ role: 'user', content: 'hola' }]);
  assert.deepEqual(out, [
    { role: 'system', content: 'be helpful' },
    { role: 'user', content: 'hola' },
  ]);
});

test('turns tool_use blocks into tool_calls with stringified arguments', () => {
  const out = messagesToOpenAi('s', [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'buscando' },
        { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { q: 'leche' } },
      ],
    },
  ]);

  const msg = out[1]!;
  assert.equal(msg.role, 'assistant');
  assert.equal(msg.content, 'buscando');
  assert.deepEqual(msg.tool_calls, [
    { id: 'toolu_1', type: 'function', function: { name: 'search_products', arguments: '{"q":"leche"}' } },
  ]);
});

test('drops thinking blocks rather than replaying them to another model', () => {
  const out = messagesToOpenAi('s', [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me consider', signature: 'sig' },
        { type: 'text', text: 'listo' },
      ],
    },
  ]);

  assert.equal(out[1]!.content, 'listo');
  assert.equal(JSON.stringify(out).includes('let me consider'), false);
});

test('splits one user message of tool results into a message per result', () => {
  // This is the format divergence the whole file exists for: Anthropic batches
  // every result into one user message, OpenAI wants one each.
  const out = messagesToOpenAi('s', [
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'twelve items' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'four items' },
      ],
    },
  ]);

  assert.deepEqual(out.slice(1), [
    { role: 'tool', tool_call_id: 'toolu_1', content: 'twelve items' },
    { role: 'tool', tool_call_id: 'toolu_2', content: 'four items' },
  ]);
});

test('keeps the results ahead of text in the same message', () => {
  // The text in a mixed user message is the state banner, which is the newest
  // thing said and so must not land above the tool output it follows.
  const out = messagesToOpenAi('s', [
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
        { type: 'text', text: 'estado: carrito vacío' },
      ],
    },
  ]);

  assert.deepEqual(
    out.slice(1).map((m) => m.role),
    ['tool', 'user'],
  );
});

test('flattens a structured tool result into a string', () => {
  const out = messagesToOpenAi('s', [
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
      ],
    },
  ]);

  assert.equal(out[1]!.content, 'line one\nline two');
});

test('pairs every tool_call_id back to a tool_use id', () => {
  // The pairing is what the next request is validated on, and an unmatched id
  // is rejected a whole turn later — on a turn that did nothing wrong.
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'armá un desayuno' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_abc', name: 'search_products', input: {} }],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'ok' }] },
  ];

  const out = messagesToOpenAi('s', messages);
  const asked = out.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : []));
  const answered = out.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : []));
  assert.deepEqual(asked, answered);
});

// ------------------------------------------------------------- the reply back

test('accumulates arguments that arrive in fragments', () => {
  const acc = feed([
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_products' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"leche"}' } }] }),
  ]);

  assert.deepEqual(acc.content(), [
    { type: 'tool_use', id: 'c1', name: 'search_products', input: { q: 'leche' } },
  ]);
});

test('a later fragment carrying only arguments does not blank the name', () => {
  const acc = feed([
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'view_cart' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }),
  ]);

  const block = acc.content()[0] as Anthropic.ToolUseBlockParam;
  assert.equal(block.name, 'view_cart');
});

test('orders tool calls by index, not by arrival', () => {
  const acc = feed([
    chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{}' } }] }),
    chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'first', arguments: '{}' } }] }),
  ]);

  assert.deepEqual(
    acc.content().map((b) => (b as Anthropic.ToolUseBlockParam).name),
    ['first', 'second'],
  );
});

test('synthesizes an id when the server omits one', () => {
  // Ollama does this. The id only has to be stable within the turn, because
  // the only thing reading it is the tool_result we pair back ourselves.
  const acc = feed([chunk({ tool_calls: [{ index: 0, function: { name: 'view_cart', arguments: '{}' } }] })]);

  const block = acc.content()[0] as Anthropic.ToolUseBlockParam;
  assert.equal(block.id, 'call_0');
});

test('a tool call outranks a finish_reason of stop', () => {
  // Some servers send both. Believing `stop` would end the turn with the
  // basket half built.
  const acc = feed([
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'view_cart', arguments: '{}' } }] }, 'stop'),
  ]);

  assert.equal(acc.stopReason(), 'tool_use');
});

test('reports a truncated reply as max_tokens', () => {
  assert.equal(feed([chunk({ content: 'cortado' }, 'length')]).stopReason(), 'max_tokens');
});

test('a plain reply ends the turn', () => {
  assert.equal(feed([chunk({ content: 'listo' }, 'stop')]).stopReason(), 'end_turn');
});

test('unparseable arguments become an empty object, not an exception', () => {
  // A local model producing broken JSON is routine. `{}` reaches the tool as a
  // missing-argument error the model can read and correct; throwing would kill
  // the turn over a trailing comma.
  const acc = feed([
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_products', arguments: '{"q":,}' } }] }),
  ]);

  const block = acc.content()[0] as Anthropic.ToolUseBlockParam;
  assert.deepEqual(block.input, {});
});

test('returns the deltas to emit and tracks whether anything was shown', () => {
  const acc = new ReplyAccumulator();
  assert.equal(acc.emittedAnything(), false);

  assert.deepEqual(acc.push(chunk({ reasoning_content: 'pensando' })), { thinking: 'pensando' });
  // Reasoning alone is not something the user can be held to — the silent
  // retry on Sonnet is still available.
  assert.equal(acc.emittedAnything(), false);

  assert.deepEqual(acc.push(chunk({ content: 'hola' })), { text: 'hola' });
  assert.equal(acc.emittedAnything(), true);
});

test('puts text ahead of tool calls in the content blocks', () => {
  const acc = feed([
    chunk({ content: 'buscando leche' }),
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_products', arguments: '{}' } }] }),
  ]);

  assert.deepEqual(
    acc.content().map((b) => b.type),
    ['text', 'tool_use'],
  );
});

// ----------------------------------------------------------------- the stream

test('parses SSE frames and ignores the DONE sentinel', () => {
  const { chunks, rest } = parseSseChunks(
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\n',
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.choices![0]!.delta!.content, 'a');
  assert.equal(rest, '');
});

test('returns a split frame as the remainder instead of dropping it', () => {
  // A frame can be cut anywhere, including inside a JSON string.
  const first = parseSseChunks('data: {"choices":[{"delta":{"content":"ho');
  assert.deepEqual(first.chunks, []);

  const second = parseSseChunks(first.rest + 'la"}}]}\n\n');
  assert.equal(second.chunks[0]!.choices![0]!.delta!.content, 'hola');
});

test('drops an unparseable frame rather than killing the stream', () => {
  const { chunks } = parseSseChunks('data: {not json}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n');
  assert.equal(chunks.length, 1);
});
