/**
 * Per-instance burst guard. A warm lambda remembers recent callers; a cold
 * one does not. That is enough to blunt a tight loop without a shared store.
 * Callers still have to pass validation, and the honeypot drops dumb bots.
 */

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 8;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_MAX = 3;
const MAX_KEYS = 2000;

export type RateBuckets = Map<string, number[]>;

const buckets: RateBuckets = new Map();

export function rateBuckets(): RateBuckets {
  return buckets;
}

/** True when this caller may continue. A rejection still records the attempt. */
export function allowSubmission(
  ip: string,
  email: string | undefined,
  now: number,
  store: RateBuckets = buckets,
): boolean {
  prune(store, now);
  const ipOk = hit(`ip:${ip.slice(0, 80) || 'unknown'}`, now, IP_WINDOW_MS, IP_MAX, store);
  if (!ipOk) return false;
  if (!email) return true;
  return hit(`email:${email}`, now, EMAIL_WINDOW_MS, EMAIL_MAX, store);
}

function hit(key: string, now: number, windowMs: number, max: number, store: RateBuckets): boolean {
  const fresh = (store.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (fresh.length >= max) {
    store.set(key, fresh);
    return false;
  }
  fresh.push(now);
  store.set(key, fresh);
  return true;
}

function prune(store: RateBuckets, now: number) {
  if (store.size < MAX_KEYS) return;
  for (const [key, stamps] of store) {
    if (stamps.every((stamp) => now - stamp >= EMAIL_WINDOW_MS)) store.delete(key);
  }
}
