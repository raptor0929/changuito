import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { WaitlistEntry } from './validate.ts';

/**
 * Durable sinks, in the order the landing can actually use them.
 *
 * The shopper already talks to Upstash Redis (`KV_REST_*` on Vercel, or
 * `UPSTASH_REDIS_REST_*`). The landing is a separate Vercel project and does
 * not inherit those variables, so Redis is used only when this project has
 * them. Otherwise a webhook is the durable path: point it at Notion, Sheets,
 * Slack or anything that accepts JSON. With neither set, production refuses
 * to pretend the signup was stored. Local dev appends a JSON line under
 * `.data/` so the form can be tried without credentials.
 *
 * The hash key is namespaced `changuito:landing:` so it does not collide with
 * shopper session keys if both apps share one Redis database.
 */

const HASH_KEY = 'changuito:landing:waitlist';

export type SaveResult =
  | { ok: true; sink: 'redis' | 'webhook' | 'file' }
  | { ok: false; reason: 'unconfigured' | 'upstream' };

export type SaveDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  appendLine?: (line: string) => Promise<void>;
};

export async function saveWaitlistEntry(entry: WaitlistEntry, deps: SaveDeps): Promise<SaveResult> {
  const redis = redisCredentials(deps.env);
  const webhook = webhookTarget(deps.env);

  if (redis) {
    const saved = await saveRedis(redis, entry, deps.fetch);
    if (saved) {
      if (webhook) {
        const notified = await postWebhook(webhook, entry, deps.fetch);
        if (!notified) console.error('[waitlist] webhook notify failed after redis save');
      }
      return { ok: true, sink: 'redis' };
    }
    if (webhook) {
      const notified = await postWebhook(webhook, entry, deps.fetch);
      if (notified) return { ok: true, sink: 'webhook' };
    }
    return { ok: false, reason: 'upstream' };
  }

  if (webhook) {
    const notified = await postWebhook(webhook, entry, deps.fetch);
    return notified ? { ok: true, sink: 'webhook' } : { ok: false, reason: 'upstream' };
  }

  if (deps.env.NODE_ENV === 'production') {
    console.error(
      '[waitlist] no sink configured. Set WAITLIST_WEBHOOK_URL or KV_REST_API_URL and KV_REST_API_TOKEN.',
    );
    return { ok: false, reason: 'unconfigured' };
  }

  try {
    const write = deps.appendLine ?? defaultAppend;
    await write(`${JSON.stringify(entry)}\n`);
    return { ok: true, sink: 'file' };
  } catch (error) {
    console.error('[waitlist] local file save failed', error instanceof Error ? error.message : 'unknown');
    return { ok: false, reason: 'upstream' };
  }
}

type RedisAuth = { url: string; token: string };
type WebhookAuth = { url: string; secret?: string };

function redisCredentials(env: NodeJS.ProcessEnv): RedisAuth | undefined {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return undefined;
  if (!isHttps(url)) return undefined;
  return { url: url.replace(/\/$/, ''), token };
}

function webhookTarget(env: NodeJS.ProcessEnv): WebhookAuth | undefined {
  const raw = (env.WAITLIST_WEBHOOK_URL || '').trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) {
    const secret = (env.WAITLIST_WEBHOOK_SECRET || '').trim();
    return { url: url.toString(), secret: secret || undefined };
  }
  return undefined;
}

async function saveRedis(auth: RedisAuth, entry: WaitlistEntry, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const result = await upstash(auth, ['HSETNX', HASH_KEY, entry.email, JSON.stringify(entry)], fetchImpl);
    return result === 0 || result === 1;
  } catch (error) {
    console.error('[waitlist] redis save failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

async function upstash(auth: RedisAuth, command: string[], fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(auth.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function postWebhook(target: WebhookAuth, entry: WaitlistEntry, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Changuito-Waitlist': '1',
    };
    if (target.secret) headers.Authorization = `Bearer ${target.secret}`;
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: entry.name,
        email: entry.email,
        source: entry.source,
        otherDetail: entry.otherDetail ?? null,
        createdAt: entry.createdAt,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`[waitlist] webhook status ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[waitlist] webhook failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function defaultAppend(line: string): Promise<void> {
  const file = join(process.cwd(), '.data', 'waitlist.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, line, 'utf8');
}
