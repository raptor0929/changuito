import type { BugReportEntry } from './validate.ts';

/**
 * Bug reports are allowed to land with no destination.
 *
 * The waitlist refuses a production signup that has nowhere to go, because
 * pretending someone joined the list is worse than an error. A bug report is
 * the opposite: the page has to accept the note even when nobody has set
 * `BUG_REPORT_WEBHOOK_URL` yet. In that case the process log is the record
 * (`[bug-report]`). When the URL is set, a failed forward is a real failure
 * so the visitor can retry instead of thinking we kept a report we dropped.
 */

export type SaveResult =
  | { ok: true; sink: 'webhook' | 'log' }
  | { ok: false; reason: 'upstream' };

export type SaveDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  log?: (entry: BugReportEntry) => void;
};

export async function saveBugReport(entry: BugReportEntry, deps: SaveDeps): Promise<SaveResult> {
  const webhook = webhookTarget(deps.env);

  if (webhook.kind === 'invalid') {
    console.error('[bug-report] BUG_REPORT_WEBHOOK_URL is set but not a usable http(s) URL. Logging instead.');
  }

  if (webhook.kind === 'ok') {
    const notified = await postWebhook(webhook, entry, deps.fetch);
    return notified ? { ok: true, sink: 'webhook' } : { ok: false, reason: 'upstream' };
  }

  const write = deps.log ?? defaultLog;
  write(entry);
  return { ok: true, sink: 'log' };
}

type WebhookTarget =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'ok'; url: string; secret?: string };

function webhookTarget(env: NodeJS.ProcessEnv): WebhookTarget {
  const raw = (env.BUG_REPORT_WEBHOOK_URL || '').trim();
  if (!raw) return { kind: 'missing' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'invalid' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) {
    const secret = (env.BUG_REPORT_WEBHOOK_SECRET || '').trim();
    return { kind: 'ok', url: url.toString(), secret: secret || undefined };
  }
  return { kind: 'invalid' };
}

async function postWebhook(
  target: { url: string; secret?: string },
  entry: BugReportEntry,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Changuito-Bug-Report': '1',
    };
    if (target.secret) headers.Authorization = `Bearer ${target.secret}`;
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: entry.name,
        email: entry.email,
        description: entry.description,
        context: entry.context ?? null,
        severity: entry.severity ?? null,
        createdAt: entry.createdAt,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`[bug-report] webhook status ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[bug-report] webhook failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function defaultLog(entry: BugReportEntry): void {
  console.info(`[bug-report] ${JSON.stringify(entry)}`);
}
