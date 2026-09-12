import { RetailerError } from '../types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** VTEX documents a 45s timeout on orderForm requests; stay just inside it. */
const TIMEOUT_MS = 40_000;

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** Retries on 429/5xx. Writes default to 0 — see requestSerialized. */
  retries?: number;
}

/**
 * Politeness gate. VTEX publishes a limit for the Catalog API but none for
 * Intelligent Search or Checkout, and neither spec declares a 429. We assume
 * undisclosed limits and stay well under any plausible one.
 */
class RateLimiter {
  private last = 0;
  constructor(private readonly minGapMs: number) {}
  async wait(): Promise<void> {
    const gap = Date.now() - this.last;
    if (gap < this.minGapMs) {
      await sleep(this.minGapMs - gap);
    }
    this.last = Date.now();
  }
}

const limiters = new Map<string, RateLimiter>();
function limiterFor(host: string): RateLimiter {
  let l = limiters.get(host);
  if (!l) {
    l = new RateLimiter(120);
    limiters.set(host, l);
  }
  return l;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, retries = 2 } = opts;
  const host = new URL(url).host;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiterFor(host).wait();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Accept-Language': 'es-AR,es;q=0.9',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        if (attempt < retries) {
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new RetailerError('Rate limited by the store', 'RATE_LIMITED',
          'Wait a few seconds and try again.');
      }

      if (res.status >= 500 && attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }

      const text = await res.text();

      // A 200 is not proof of an API. Coto returns HTTP 200 with an Angular
      // shell for every VTEX path; without this check the adapter would happily
      // "succeed" and then fail deep inside a JSON parse with a useless message.
      const head = text.trimStart()[0];
      if (head !== '{' && head !== '[') {
        throw new RetailerError(
          `${host} returned HTML, not JSON (HTTP ${res.status}) — this endpoint does not exist on this store`,
          'UPSTREAM',
          'The retailer is probably not on the platform this adapter assumes.',
        );
      }

      const json = JSON.parse(text) as T;
      if (!res.ok) {
        const err = json as { error?: { code?: string; message?: string } };
        throw new RetailerError(
          err?.error?.message ?? `HTTP ${res.status} from ${host}`,
          'UPSTREAM',
          err?.error?.code,
        );
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (e instanceof RetailerError) throw e;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RetailerError(
    `Request to ${host} failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    'UPSTREAM',
  );
}

/**
 * VTEX is explicit: "Data modification operations shall not be performed in
 * parallel in the Checkout APIs. They need to be enqueued by the client."
 * A Promise.all over add_to_cart silently corrupts the cart, so every write
 * for a given cart goes through this queue.
 */
const chains = new Map<string, Promise<unknown>>();

export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}
