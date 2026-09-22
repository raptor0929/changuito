import { allowSubmission, type RateBuckets } from '../waitlist/rate-limit.ts';
import { saveBugReport, type SaveDeps } from './persist.ts';
import { validateBugReport, type FieldErrors } from './validate.ts';

export type SubmitBody = {
  name: unknown;
  email: unknown;
  description: unknown;
  context: unknown;
  severity: unknown;
  company: unknown;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; status: 400 | 429 | 503; errors: FieldErrors & { form?: string } };

const FORM_ERROR = 'No pudimos recibir el reporte. Probá de nuevo en un rato.';
const RATE_ERROR = 'Esperá un toque y volvé a intentar.';

export async function submitBugReport(
  body: SubmitBody,
  ctx: { ip: string; now: number; buckets?: RateBuckets } & SaveDeps,
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
  if (!validated.ok) return { ok: false, status: 400, errors: validated.errors };

  const allowed = allowSubmission(ctx.ip, validated.entry.email, ctx.now, ctx.buckets);
  if (!allowed) return { ok: false, status: 429, errors: { form: RATE_ERROR } };

  const saved = await saveBugReport(validated.entry, ctx);
  if (!saved.ok) return { ok: false, status: 503, errors: { form: FORM_ERROR } };
  return { ok: true };
}

function honeypotFilled(value: unknown): boolean {
  return asText(value).trim().length > 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
