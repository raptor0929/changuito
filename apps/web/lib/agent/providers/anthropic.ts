import Anthropic from '@anthropic-ai/sdk';

import type { HopCallbacks, HopRequest, HopResult, Provider } from './types';

/**
 * The hosted model. Everything here was in `loop.ts` before there was anything
 * to choose between; lifting it out unchanged is the point, so that the path
 * carrying real traffic is provably the same one.
 */

// Override to compare: AGENT_MODEL=claude-haiku-4-5-20251001 npm run dev
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';

/**
 * Adaptive thinking and the effort control are Claude 5 features — Haiku 4.5
 * rejects the request outright with "adaptive thinking is not supported on
 * this model". It still thinks, it just wants a fixed budget instead. Swapping
 * MODEL alone is not enough; the request shape has to follow.
 */
const isClaude5 = /^claude-(opus|sonnet|fable)-5/.test(MODEL);
const THINKING = isClaude5
  ? ({ type: 'adaptive', display: 'summarized' } as const)
  : ({ type: 'enabled', budget_tokens: 2048 } as const);
const EFFORT = isClaude5 ? { output_config: { effort: 'medium' as const } } : {};

export function anthropicProvider(): Provider {
  // Built per turn rather than at module scope, as it was before: the API key
  // is read at construction, and a build without one should not fail at import.
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const client = hasKey ? new Anthropic() : null;

  return {
    kind: 'anthropic',
    label: MODEL,

    async hop(req: HopRequest, cb: HopCallbacks): Promise<HopResult> {
      if (!client) {
        throw new Error(
          'Falta ANTHROPIC_API_KEY. En local usá AGENT_PROVIDER=ollama con Ollama corriendo.',
        );
      }
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8192,
        thinking: THINKING,
        ...EFFORT,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
      });

      stream.on('text', (delta) => cb.onText(delta));
      stream.on('thinking', (delta) => cb.onThinking(delta));

      const msg = await stream.finalMessage();

      if (process.env.AGENT_USAGE) {
        const u = msg.usage;
        console.log(
          `[usage] ${MODEL} in=${u.input_tokens} out=${u.output_tokens} ` +
            `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
        );
      }

      return { content: msg.content, stopReason: msg.stop_reason };
    },
  };
}
