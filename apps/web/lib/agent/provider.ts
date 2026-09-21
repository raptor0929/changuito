import { anthropicProvider } from './providers/anthropic';
import { ollamaConfig, ollamaGate, type Denial, type Lease } from './providers/gate';
import { ollamaProvider } from './providers/ollama';
import type { Provider } from './providers/types';

/**
 * Which model answers this turn.
 *
 * The shape of the answer is "both, in order of preference" rather than "one",
 * because the interesting case is a turn that starts local and finishes
 * hosted. That is legal only because `turn.messages` is Anthropic-shaped
 * throughout — see the note at the top of `providers/wire.ts`.
 */

export type Mode = 'auto' | 'ollama' | 'anthropic';

export interface Brains {
  /** Preferred, when it is up and free. The lease must be released. */
  local?: { provider: Provider; lease: Lease };
  /** Always constructed. It is the thing that makes the local model optional. */
  remote: Provider;
  mode: Mode;
  /** Why `local` is absent, when it is. */
  denial?: Denial | 'not-configured' | 'disabled';
}

/**
 * `auto` is the default whenever `OLLAMA_URL` is set, because a configured
 * local model that is never used is the more confusing failure.
 */
function mode(): Mode {
  const raw = process.env.AGENT_PROVIDER?.trim().toLowerCase();
  if (raw === 'ollama' || raw === 'anthropic' || raw === 'auto') return raw;
  return process.env.OLLAMA_URL ? 'auto' : 'anthropic';
}

export async function selectBrains(): Promise<Brains> {
  const remote = anthropicProvider();
  const m = mode();

  if (m === 'anthropic') return { remote, mode: m, denial: 'disabled' };

  const cfg = ollamaConfig();
  if (!cfg) {
    // `AGENT_PROVIDER=ollama` with no URL is a misconfiguration worth saying
    // out loud. It would otherwise present as "the local model is never used".
    if (m === 'ollama') console.error('[provider] AGENT_PROVIDER=ollama but OLLAMA_URL is not set.');
    return { remote, mode: m, denial: 'not-configured' };
  }

  const acquired = await ollamaGate().acquire(cfg);
  if (typeof acquired === 'string') {
    // Not an error. `busy` is the ordinary case on a site with two visitors,
    // and overflowing to the faster model is the design working.
    console.log(`[provider] local model unavailable (${acquired}) — using ${remote.label}`);
    return { remote, mode: m, denial: acquired };
  }

  return { local: { provider: ollamaProvider(cfg), lease: acquired }, remote, mode: m };
}
