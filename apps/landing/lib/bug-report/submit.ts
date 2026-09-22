import { allowSubmission, type RateBuckets } from '../waitlist/rate-limit.ts';
import { validateAttachments } from './attachments.ts';
import { saveBugReport, type SaveDeps } from './persist.ts';
import { validateBugReport, type BugReportEntry, type FieldErrors } from './validate.ts';

export type SubmitBody = {
  name: unknown;
  email: unknown;
  description: unknown;
  context: unknown;
  severity: unknown;
  company: unknown;
  adjuntos?: unknown;
  attachments?: unknown;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; status: 400 | 429 | 503; errors: FieldErrors & { form?: string; attachments?: string } };

const FORM_ERROR = 'No pudimos recibir el reporte. Probá de nuevo en un rato.';
const RATE_ERROR = 'Esperá un toque y volvé a intentar.';

export async function submitBugReport(
  body: SubmitBody,
  ctx: { ip: string; now: number; buckets?: RateBuckets; userAgent?: string } & SaveDeps,
): Promise<SubmitResult> {
  if (honeypotFilled(body.company)) return { ok: true };

  const validated = validateBugReport(
    {
      name: asText(body.name),
      email: asText(body.email),
      description: asText(body.description),
      context: asText(body.context),
      severity: asText(body.severity),
    },
    new Date(ctx.now).toISOString(),
  );
  const files = validateAttachments(body.adjuntos ?? body.attachments);
  if (!validated.ok || !files.ok) {
    return {
      ok: false,
      status: 400,
      errors: {
        ...(validated.ok ? {} : validated.errors),
        ...(files.ok ? {} : { attachments: files.error }),
      },
    };
  }

  const allowed = allowSubmission(ctx.ip, validated.entry.email, ctx.now, ctx.buckets);
  if (!allowed) return { ok: false, status: 429, errors: { form: RATE_ERROR } };

  const entry: BugReportEntry = { ...validated.entry };
  if (files.adjuntos.length > 0) entry.adjuntos = files.adjuntos;
  const userAgent = ctx.userAgent?.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (userAgent) entry.userAgent = userAgent;

  const saved = await saveBugReport(entry, ctx);
  if (!saved.ok) return { ok: false, status: 503, errors: { form: FORM_ERROR } };
  return { ok: true };
}

function honeypotFilled(value: unknown): boolean {
  return asText(value).trim().length > 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
