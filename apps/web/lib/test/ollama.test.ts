import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';

import type { OllamaConfig } from '../agent/providers/gate.ts';
import { ollamaProvider } from '../agent/providers/ollama.ts';
import { ProviderFailure } from '../agent/providers/types.ts';

/**
 * A fake completions endpoint, so the streaming path is exercised over a real
 * socket. `wire.ts` is tested on its own with synthetic chunks; what this file
 * covers is everything between the socket and those chunks — frame boundaries
 * that fall wherever the kernel put them, a non-200, a body that ends early.
 */
function completionsServer(
  handler: (write: (frame: string) => void, end: () => void) => void,
  status = 200,
): Promise<{ url: string; close: () => Promise<void>; body: () => unknown }> {
  let received: unknown;
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          received = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          received = undefined;
        }
        res.writeHead(status, { 'Content-Type': 'text/event-stream' });
        if (status !== 200) return res.end('model requires more system memory');
        handler(
          (frame) => res.write(frame),
          () => res.end(),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
        body: () => received,
      });
    });
  });
}

const config = (url: string): OllamaConfig => ({
  url,
  model: 'qwen3:8b',
  headers: { 'Content-Type': 'application/json' },
  lanes: 1,
});

const request = {
  system: [{ type: 'text' as const, text: 'sos changuito' }],
  tools: [{ name: 'search_products', input_schema: { type: 'object' as const } }],
  messages: [{ role: 'user' as const, content: 'leche' }],
  budgetMs: 10_000,
};

const collect = () => {
  const text: string[] = [];
  const thinking: string[] = [];
  return { text, thinking, cb: { onText: (d: string) => text.push(d), onThinking: (d: string) => thinking.push(d) } };
};

test('streams text and returns it as one content block', async () => {
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{"content":"armando "}}]}\n\n');
    write('data: {"choices":[{"delta":{"content":"el carrito"}}]}\n\n');
    write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    const { text, cb } = collect();
    const result = await ollamaProvider(config(srv.url)).hop(request, cb);

    // Emitted as they arrive, so the UI streams rather than waiting.
    assert.deepEqual(text, ['armando ', 'el carrito']);
    assert.deepEqual(result.content, [{ type: 'text', text: 'armando el carrito' }]);
    assert.equal(result.stopReason, 'end_turn');
  } finally {
    await srv.close();
  }
});

test('reassembles a tool call whose arguments span frames', async () => {
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_products"}}]}}]}\n\n');
    write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]}}]}\n\n');
    write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"leche\\"}"}}]}}]}\n\n');
    write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    const result = await ollamaProvider(config(srv.url)).hop(request, collect().cb);
    assert.equal(result.stopReason, 'tool_use');
    assert.deepEqual(result.content, [
      { type: 'tool_use', id: 'c1', name: 'search_products', input: { q: 'leche' } },
    ]);
  } finally {
    await srv.close();
  }
});

test('survives a frame split mid-JSON by the kernel', async () => {
  // Nothing guarantees a write lands as one read. This is the bug that only
  // shows up under load, so it gets a test rather than a hope.
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{"content":"ho');
    write('la"}}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    const result = await ollamaProvider(config(srv.url)).hop(request, collect().cb);
    assert.deepEqual(result.content, [{ type: 'text', text: 'hola' }]);
  } finally {
    await srv.close();
  }
});

test('reports reasoning separately from the reply', async () => {
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{"reasoning_content":"pensando"}}]}\n\n');
    write('data: {"choices":[{"delta":{"content":"listo"}}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    const { text, thinking, cb } = collect();
    await ollamaProvider(config(srv.url)).hop(request, cb);
    assert.deepEqual(thinking, ['pensando']);
    assert.deepEqual(text, ['listo']);
  } finally {
    await srv.close();
  }
});

test('translates the request into the OpenAI shape on the wire', async () => {
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    await ollamaProvider(config(srv.url)).hop(request, collect().cb);
    const body = srv.body() as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };

    assert.equal(body.model, 'qwen3:8b');
    assert.equal(body.stream, true);
    assert.deepEqual(body.messages[0], { role: 'system', content: 'sos changuito' });
    assert.equal(body.tools[0]!.function.name, 'search_products');
  } finally {
    await srv.close();
  }
});

test('a non-200 is a ProviderFailure the loop can fall back on', async () => {
  const srv = await completionsServer(() => {}, 500);
  try {
    await assert.rejects(
      ollamaProvider(config(srv.url)).hop(request, collect().cb),
      (e: unknown) => {
        assert.ok(e instanceof ProviderFailure);
        assert.equal(e.stage, 'request');
        // The body is carried through: "requires more system memory" is worth
        // having in the log rather than a bare 500.
        assert.match(e.message, /more system memory/);
        return true;
      },
    );
  } finally {
    await srv.close();
  }
});

test('nothing listening is a ProviderFailure, not a crash', async () => {
  await assert.rejects(
    ollamaProvider(config('http://127.0.0.1:1')).hop(request, collect().cb),
    (e: unknown) => e instanceof ProviderFailure && e.stage === 'request',
  );
});

test('an empty reply is a failure, not an answer', async () => {
  // Returning it would end the turn in silence. It is also the usual shape of
  // a context overflow, so the message says where to look.
  const srv = await completionsServer((write, end) => {
    write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    end();
  });

  try {
    await assert.rejects(ollamaProvider(config(srv.url)).hop(request, collect().cb), (e: unknown) => {
      assert.ok(e instanceof ProviderFailure);
      assert.match(e.message, /OLLAMA_CONTEXT_LENGTH/);
      return true;
    });
  } finally {
    await srv.close();
  }
});

test('abandons a hop that outlasts its budget', async () => {
  // The turn's remaining share of maxDuration, not a fixed timeout: hop nine
  // cannot be given the budget hop one had.
  const srv = await completionsServer((write) => {
    write('data: {"choices":[{"delta":{"content":"empezando"}}]}\n\n');
    // and then never finishes
  });

  try {
    await assert.rejects(
      ollamaProvider(config(srv.url)).hop({ ...request, budgetMs: 300 }, collect().cb),
      (e: unknown) => e instanceof ProviderFailure && e.stage === 'stream',
    );
  } finally {
    await srv.close();
  }
});
