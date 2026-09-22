import { Redis } from '@upstash/redis';

/**
 * Whether a request is allowed to use the local model right now.
 *
 * Three separate questions, and conflating them is how a fallback ends up
 * slower than no fallback at all:
 *
 *   1. Is the machine reachable and holding the right model?   — the probe
 *   2. Has it been failing?                                    — the breaker
 *   3. Is it already busy with someone else's basket?          — the lease
 *
 * All three live in Redis rather than module scope. That is the same lesson as
 * `turn-store.ts`: a lambda's module scope is a cache, not a database, so a
 * per-instance breaker means every cold start rediscovers that the laptop is
 * asleep by paying the full timeout — and the visitor pays it too. One shared
 * breaker means the first request absorbs that cost and the rest are told
 * immediately.
 *
 * With no Redis configured this degrades to per-process state, which on one
 * developer's machine is the same guarantee for free.
 */

/** Long enough to cover a slow hop, short enough that a crashed lambda's lease expires. */
const LEASE_SECONDS = 120;

/** Consecutive failures before the local model is taken out of rotation. */
const FAIL_THRESHOLD = 3;

/** How long it stays out. A sleeping laptop is not waking up in ten seconds. */
const OPEN_SECONDS = 60;

/** A reachability answer is worth reusing, but not for long. */
const PROBE_TTL_SECONDS = 30;

/**
 * One in-flight local turn by default.
 *
 * A 16GB machine runs one model instance. Raising this does not buy
 * parallelism, it buys a queue — and a queued visitor waits behind a stranger's
 * groceries when Sonnet would have answered them in a second. Overflow going
 * to the *faster* model is a comfortable kind of degradation, so the default
 * keeps the queue at zero.
 */
const DEFAULT_LANES = 1;

const K = {
  breaker: 'changuito:ollama:breaker',
  probe: 'changuito:ollama:probe',
  lane: (i: number) => `changuito:ollama:lane:${i}`,
};

export interface OllamaConfig {
  url: string;
  model: string;
  headers: Record<string, string>;
  lanes: number;
}

/** Why the local model was not used. Logged, and shown in the dev banner. */
export type Denial = 'breaker-open' | 'busy' | 'unreachable' | 'model-missing';

export interface Lease {
  release(outcome: 'ok' | 'fail'): Promise<void>;
}

export interface Gate {
  /** A lease, or the reason there isn't one. Never throws, never blocks. */
  acquire(cfg: OllamaConfig): Promise<Lease | Denial>;
  readonly kind: 'redis' | 'memory';
}

// -------------------------------------------------------------- the reachability probe

interface ProbeResult {
  ok: boolean;
  /** Absent when the server answered but the model is not pulled. */
  denial?: Denial;
}

/**
 * Asks the server what it has, rather than only whether it answers.
 *
 * "Is the port open" is the wrong question: Ollama answers `/api/tags` happily
 * while holding no models at all, and a request for one it does not have fails
 * per-request, after the user is already waiting. Checking presence up front
 * turns that into an instant fallback.
 */
async function probe(cfg: OllamaConfig): Promise<ProbeResult> {
  // 2s, not the 1s that would do for localhost: this crosses a tunnel, and a
  // Wi-Fi radio coming out of power-save can eat most of a second on its own.
  // A false negative here is a visitor silently routed to Sonnet, which is the
  // kind of bug that never gets reported, only wondered about.
  const signal = AbortSignal.timeout(2000);

  try {
    const res = await fetch(`${cfg.url}/api/tags`, { headers: cfg.headers, signal });
    // An authenticated tunnel rejects at the edge, so a 403 here means the
    // service token is wrong, not that the Mac is off. Same denial either way,
    // but the log line should not lie about which.
    if (!res.ok) {
      console.warn(`[gate] probe got HTTP ${res.status} — check OLLAMA_HEADERS if this is 401/403`);
      return { ok: false, denial: 'unreachable' };
    }

    const body = (await res.json()) as { models?: { name?: string }[] };
    const names = (body.models ?? []).map((m) => m.name ?? '');

    // `qwen3:8b` and `qwen3:8b-q4_K_M` are both reasonable spellings of the
    // same pull, and Ollama reports the tag it was pulled under. Prefix
    // matching keeps a config that names the family from failing on the tag.
    const present = names.some((n) => n === cfg.model || n.startsWith(`${cfg.model}-`));
    if (!present) {
      console.warn(`[gate] ${cfg.model} is not pulled. Has: ${names.join(', ') || '(nothing)'}`);
      return { ok: false, denial: 'model-missing' };
    }

    return { ok: true };
  } catch {
    return { ok: false, denial: 'unreachable' };
  }
}

// ------------------------------------------------------------------- backends

interface BreakerState {
  fails: number;
  openUntil: number;
}

function redisGate(url: string, token: string): Gate {
  const redis = new Redis({ url, token });

  /**
   * Read-modify-write, not an atomic counter.
   *
   * Two lambdas failing at once can record one failure instead of two, which
   * delays the breaker opening by a single request. The alternative is a Lua
   * script to maintain a number whose only job is to be roughly three, so the
   * race is accepted deliberately rather than overlooked.
   */
  async function recordFailure(): Promise<void> {
    const prev = ((await redis.get(K.breaker)) as BreakerState | null) ?? { fails: 0, openUntil: 0 };
    const fails = prev.fails + 1;
    const openUntil = fails >= FAIL_THRESHOLD ? Date.now() + OPEN_SECONDS * 1000 : 0;
    if (openUntil) console.warn(`[gate] ${fails} failures — local model out for ${OPEN_SECONDS}s`);
    await redis.set(K.breaker, { fails, openUntil }, { ex: OPEN_SECONDS * 2 });
  }

  return {
    kind: 'redis',

    async acquire(cfg) {
      try {
        const breaker = (await redis.get(K.breaker)) as BreakerState | null;
        if (breaker && breaker.openUntil > Date.now()) return 'breaker-open';

        // The probe result is shared, so one visitor's 2s wait answers the
        // question for everyone who arrives in the next half minute.
        let cached = (await redis.get(K.probe)) as ProbeResult | null;
        if (!cached) {
          cached = await probe(cfg);
          await redis.set(K.probe, cached, { ex: PROBE_TTL_SECONDS });
        }
        if (!cached.ok) return cached.denial ?? 'unreachable';

        // Lanes are tried in order so that with one lane there is one key to
        // contend on, and `nx` makes claiming it atomic.
        const lanes = Math.max(1, cfg.lanes);
        for (let i = 0; i < lanes; i++) {
          const mine = crypto.randomUUID();
          const won = await redis.set(K.lane(i), mine, { nx: true, ex: LEASE_SECONDS });
          if (won !== 'OK') continue;

          return {
            release: async (outcome) => {
              try {
                // Compare before deleting: this lease may have expired during a
                // slow turn and been claimed by someone else, and releasing
                // theirs would let a third request in alongside them.
                if ((await redis.get(K.lane(i))) === mine) await redis.del(K.lane(i));
                if (outcome === 'ok') await redis.del(K.breaker);
                else await recordFailure();
              } catch (e) {
                // The lane's TTL is the backstop. Worst case the local model
                // sits idle for two minutes, which costs nobody a reply.
                console.error('[gate] release failed:', e);
              }
            },
          };
        }

        return 'busy';
      } catch (e) {
        // A Redis wobble must not decide the turn. Sonnet answers, which is
        // the same thing that happens when the laptop is off.
        console.error('[gate] unavailable, using the fallback model:', e);
        return 'unreachable';
      }
    },
  };
}

/**
 * The single-instance equivalent. Correct when there is exactly one instance.
 *
 * Exported for the tests, which need a gate they can reason about rather than
 * the module singleton — and which would otherwise have to stand up a Redis to
 * check that a breaker opens.
 */
export function memoryGate(): Gate {
  let breaker: BreakerState = { fails: 0, openUntil: 0 };
  let cached: { at: number; result: ProbeResult } | undefined;
  let inFlight = 0;

  return {
    kind: 'memory',

    async acquire(cfg) {
      if (breaker.openUntil > Date.now()) return 'breaker-open';

      if (!cached || Date.now() - cached.at > PROBE_TTL_SECONDS * 1000) {
        cached = { at: Date.now(), result: await probe(cfg) };
      }
      if (!cached.result.ok) return cached.result.denial ?? 'unreachable';

      if (inFlight >= Math.max(1, cfg.lanes)) return 'busy';
      inFlight++;

      let released = false;
      const releaseOnce = async (outcome: 'ok' | 'fail') => {
        // Idempotent: the loop releases on both the success path and in a
        // `finally`, and double-decrementing would let an extra turn in.
        if (released) return;
        released = true;
        clearTimeout(expire);
        inFlight--;

        if (outcome === 'ok') {
          breaker = { fails: 0, openUntil: 0 };
        } else {
          const fails = breaker.fails + 1;
          breaker = {
            fails,
            openUntil: fails >= FAIL_THRESHOLD ? Date.now() + OPEN_SECONDS * 1000 : 0,
          };
          // A failure means the probe's answer is stale, whatever it said.
          cached = undefined;
        }
      };

      // Same backstop as Redis TTL: a cancelled browser stream can leave the
      // lane stuck forever in the single-process gate.
      const expire = setTimeout(() => {
        void releaseOnce('fail');
      }, LEASE_SECONDS * 1000);
      expire.unref?.();

      return {
        release: releaseOnce,
      };
    },
  };
}

let gate: Gate | undefined;

export function ollamaGate(): Gate {
  if (!gate) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    gate = url && token ? redisGate(url, token) : memoryGate();
  }
  return gate;
}

// -------------------------------------------------------------------- config

/**
 * The local model's settings, or undefined if it is not configured at all.
 *
 * `OLLAMA_URL` is read server-side only and is deliberately not prefixed
 * `NEXT_PUBLIC_`: it carries a tunnel hostname and, with `OLLAMA_HEADERS`, a
 * service token. In the client bundle that pair is a public key to someone's
 * laptop.
 */
export function ollamaConfig(): OllamaConfig | undefined {
  const url = process.env.OLLAMA_URL?.replace(/\/+$/, '');
  if (!url) return undefined;

  let headers: Record<string, string> = {};
  if (process.env.OLLAMA_HEADERS) {
    try {
      headers = JSON.parse(process.env.OLLAMA_HEADERS) as Record<string, string>;
    } catch {
      // Carrying on unauthenticated would mean every request failing at the
      // tunnel edge and reading as "the Mac is down", which sends you looking
      // in the wrong place entirely.
      console.error('[gate] OLLAMA_HEADERS is not valid JSON — ignoring it.');
    }
  }

  return {
    url,
    model: process.env.OLLAMA_MODEL || 'qwen3:8b',
    headers: { 'Content-Type': 'application/json', ...headers },
    lanes: Number(process.env.OLLAMA_LANES) || DEFAULT_LANES,
  };
}
