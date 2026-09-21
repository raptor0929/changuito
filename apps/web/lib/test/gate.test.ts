import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';

import { memoryGate, type OllamaConfig } from '../agent/providers/gate.ts';

/**
 * A stand-in for Ollama's `/api/tags`, so the probe is exercised for real
 * rather than mocked. The interesting answers are all shapes this endpoint can
 * return — a server holding the wrong models, a server refusing the token —
 * and none of those are reachable through a stub of `fetch`.
 */
function tagServer(models: string[], status = 200): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const config = (url: string, over: Partial<OllamaConfig> = {}): OllamaConfig => ({
  url,
  model: 'qwen3:8b',
  headers: { 'Content-Type': 'application/json' },
  lanes: 1,
  ...over,
});

test('falls back when nothing is listening', async () => {
  // Port 1 refuses immediately, which is the sleeping-laptop case and the one
  // that has to be cheap: every visitor pays this before reaching the model.
  const gate = memoryGate();
  assert.equal(await gate.acquire(config('http://127.0.0.1:1')), 'unreachable');
});

test('falls back when the server answers but the model is not pulled', async () => {
  // "Is the port open" is the wrong question. Ollama serves /api/tags happily
  // while holding no models at all, and the request would fail per-visitor.
  const srv = await tagServer(['llama3.1:8b']);
  try {
    assert.equal(await memoryGate().acquire(config(srv.url)), 'model-missing');
  } finally {
    await srv.close();
  }
});

test('treats a rejected request as unreachable, not as a missing model', async () => {
  // A tunnel with Cloudflare Access rejects at the edge, so a 403 means the
  // service token is wrong — the Mac never saw the request.
  const srv = await tagServer([], 403);
  try {
    assert.equal(await memoryGate().acquire(config(srv.url)), 'unreachable');
  } finally {
    await srv.close();
  }
});

test('accepts a quantization suffix on the pulled tag', async () => {
  // `qwen3:8b` and `qwen3:8b-q4_K_M` are the same pull, and Ollama reports the
  // tag it was pulled under.
  const srv = await tagServer(['qwen3:8b-q4_K_M']);
  try {
    assert.notEqual(typeof (await memoryGate().acquire(config(srv.url))), 'string');
  } finally {
    await srv.close();
  }
});

test('hands out one lane at a time so nobody queues behind a stranger', async () => {
  // The reliability claim: a 16GB machine runs one model instance, so visitor
  // two must be told "busy" instantly rather than waiting out a basket.
  const srv = await tagServer(['qwen3:8b']);
  try {
    const gate = memoryGate();
    const first = await gate.acquire(config(srv.url));
    assert.notEqual(typeof first, 'string', 'the first request should get the lane');
    assert.equal(await gate.acquire(config(srv.url)), 'busy');

    if (typeof first !== 'string') await first.release('ok');
    assert.notEqual(typeof (await gate.acquire(config(srv.url))), 'string', 'released lane is reusable');
  } finally {
    await srv.close();
  }
});

test('allows two at once when configured for two lanes', async () => {
  const srv = await tagServer(['qwen3:8b']);
  try {
    const gate = memoryGate();
    const cfg = config(srv.url, { lanes: 2 });
    assert.notEqual(typeof (await gate.acquire(cfg)), 'string');
    assert.notEqual(typeof (await gate.acquire(cfg)), 'string');
    assert.equal(await gate.acquire(cfg), 'busy');
  } finally {
    await srv.close();
  }
});

test('releasing twice does not leak a lane', async () => {
  // The loop releases on the success path and again in a `finally`.
  const srv = await tagServer(['qwen3:8b']);
  try {
    const gate = memoryGate();
    const lease = await gate.acquire(config(srv.url));
    assert.notEqual(typeof lease, 'string');
    if (typeof lease !== 'string') {
      await lease.release('ok');
      await lease.release('ok');
    }
    assert.notEqual(typeof (await gate.acquire(config(srv.url))), 'string');
    assert.equal(await gate.acquire(config(srv.url)), 'busy', 'only one lane should have been returned');
  } finally {
    await srv.close();
  }
});

test('opens the breaker after three consecutive failures', async () => {
  // Without this every cold lambda rediscovers a dead machine by paying the
  // timeout, and so does the visitor who triggered it.
  const srv = await tagServer(['qwen3:8b']);
  try {
    const gate = memoryGate();
    const cfg = config(srv.url);

    for (let i = 0; i < 3; i++) {
      const lease = await gate.acquire(cfg);
      assert.notEqual(typeof lease, 'string', `attempt ${i + 1} should still be allowed`);
      if (typeof lease !== 'string') await lease.release('fail');
    }

    assert.equal(await gate.acquire(cfg), 'breaker-open');
  } finally {
    await srv.close();
  }
});

test('a success resets the failure count', async () => {
  // Otherwise a machine that hiccups once an hour eventually trips the breaker
  // on failures that are hours apart and unrelated.
  const srv = await tagServer(['qwen3:8b']);
  try {
    const gate = memoryGate();
    const cfg = config(srv.url);

    for (const outcome of ['fail', 'fail', 'ok', 'fail', 'fail'] as const) {
      const lease = await gate.acquire(cfg);
      assert.notEqual(typeof lease, 'string');
      if (typeof lease !== 'string') await lease.release(outcome);
    }

    assert.notEqual(typeof (await gate.acquire(cfg)), 'string', 'two failures after a success is not three');
  } finally {
    await srv.close();
  }
});
