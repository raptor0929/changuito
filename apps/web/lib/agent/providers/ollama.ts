import type { OllamaConfig } from './gate';
import { ProviderFailure, type HopCallbacks, type HopRequest, type HopResult, type Provider } from './types.ts';
import { messagesToOpenAi, parseSseChunks, ReplyAccumulator, toolsToOpenAi } from './wire.ts';

/**
 * The local model, over an OpenAI-compatible endpoint.
 *
 * Written against `fetch` and the raw SSE body rather than the OpenAI SDK,
 * because the app does not depend on that SDK and would be taking it on for
 * one POST. `wire.ts` does the format work and is tested on its own.
 *
 * Nothing here retries. A provider that retried internally would hide the
 * failure the gate needs to count and the loop needs to fall back on.
 */

/**
 * How long to wait for the first token before giving up on the machine.
 *
 * This is the gap the probe cannot see. The tunnel is up, the model is pulled,
 * Ollama answers `/api/tags` instantly — and then spends twenty seconds paging
 * five gigabytes off a nearly-full SSD because something evicted it. Waiting
 * that out costs the visitor their whole turn; Sonnet answers in a second.
 *
 * `OLLAMA_KEEP_ALIVE=-1` on the server is what makes this rare, by keeping the
 * model resident between requests.
 */
const FIRST_BYTE_MS = Number(process.env.OLLAMA_FIRST_BYTE_MS) || 45_000;

export function ollamaProvider(cfg: OllamaConfig): Provider {
  return {
    kind: 'ollama',
    label: cfg.model,

    async hop(req: HopRequest, cb: HopCallbacks): Promise<HopResult> {
      // The system prompt is a list of blocks here because Anthropic caches it
      // that way; the local model has no cache and wants one string.
      const system = req.system.map((b) => b.text).join('\n\n');

      const body = {
        model: cfg.model,
        stream: true,
        max_tokens: 8192,
        // Keep the weights resident between turns so the first-byte timer
        // does not fire while Ollama pages 5GB back into RAM.
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '-1',
        messages: messagesToOpenAi(system, req.messages),
        tools: toolsToOpenAi(req.tools),
        // Note what is *not* here: `num_ctx`. Ollama's OpenAI-compatible
        // endpoint ignores it, and the default of 4096 silently truncates —
        // which with twelve tool schemas means cutting the tool definitions
        // themselves, and a model that then invents tool names. It has to be
        // set on the server: `OLLAMA_CONTEXT_LENGTH=32768`, or a Modelfile with
        // `PARAMETER num_ctx 32768`. See DEPLOY.md.
      };

      const controller = new AbortController();
      let firstByteSeen = false;

      // Two deadlines, because they are two different failures. The hard stop
      // is the turn's remaining budget. The first-byte timer is the machine
      // being slow to start, and it is cleared the moment anything arrives —
      // a model generating slowly is allowed to finish.
      const hardStop = setTimeout(() => controller.abort(), req.budgetMs);
      const firstByte = setTimeout(() => controller.abort(), FIRST_BYTE_MS);

      const fail = (stage: ProviderFailure['stage'], detail: string) =>
        new ProviderFailure(`${cfg.model}: ${detail}`, stage);

      try {
        let res: Response;
        try {
          res = await fetch(`${cfg.url}/v1/chat/completions`, {
            method: 'POST',
            headers: cfg.headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (e) {
          throw fail('request', e instanceof Error ? e.message : 'unreachable');
        }

        if (!res.ok || !res.body) {
          // Read the body: Ollama explains itself here, and "model requires
          // more system memory than is available" is worth having in the log
          // rather than a bare 500.
          const detail = await res.text().catch(() => '');
          throw fail('request', `HTTP ${res.status} ${detail.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const acc = new ReplyAccumulator();
        let buffer = '';

        for (;;) {
          let done: boolean;
          let value: Uint8Array | undefined;
          try {
            ({ done, value } = await reader.read());
          } catch (e) {
            // An abort lands here. Which timer fired decides what to call it,
            // and the two are not the same thing to a reader of the logs.
            throw fail(
              firstByteSeen ? 'stream' : 'first-byte',
              firstByteSeen ? (e instanceof Error ? e.message : 'stream broke') : `no output in ${FIRST_BYTE_MS}ms`,
            );
          }
          if (done) break;

          if (!firstByteSeen) {
            firstByteSeen = true;
            clearTimeout(firstByte);
          }

          buffer += decoder.decode(value, { stream: true });
          const { chunks, rest } = parseSseChunks(buffer);
          buffer = rest;

          for (const chunk of chunks) {
            const delta = acc.push(chunk);
            if (delta.thinking) cb.onThinking(delta.thinking);
            if (delta.text) cb.onText(delta.text);
          }
        }

        const content = acc.content();
        if (!content.length) {
          // An empty reply is not an answer, and returning it would end the
          // turn with silence. Treated as a failure so the other model gets a
          // turn at it — this is the common shape of a context overflow.
          throw fail('stream', 'empty reply (is OLLAMA_CONTEXT_LENGTH large enough?)');
        }

        return { content, stopReason: acc.stopReason() };
      } finally {
        clearTimeout(hardStop);
        clearTimeout(firstByte);
      }
    },
  };
}
