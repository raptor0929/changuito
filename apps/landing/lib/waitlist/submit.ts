import { allowSubmission, type RateBuckets } from './rate-limit.ts';
import { saveWaitlistEntry, type SaveDeps } from './persist.ts';
import { validateWaitlist, type FieldErrors } from './validate.ts';

export type SubmitBody = {
  name: unknown;
  email: unknown;
  source: unknown;
  otherDetail: unknown;
  company: unknown;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; status: 400 | 429 | 503; errors: FieldErrors & { form?: string } };

const FORM_ERROR = 'No pudimos anotarte. Probá de nuevo en un rato.';
const RATE_ERROR = 'Esperá un toque y volvé a intentar.';

export async function submitWaitlist(
  body: SubmitBody,
  ctx: { ip: string; now: number; buckets?: RateBuckets } & SaveDeps,
): Promise<SubmitResult> {
  if (honeypotFilled(body.company)) return { ok: true };

  const input = {
    name: asText(body.name),
    email: asText(body.email),
    source: asText(body.source),
    otherDetail: asText(body.otherDetail),
  };

  const validated = validateWaitlist(input, new Date(ctx.now).toISOString());
  if (!validated.ok) return { ok: false, status: 400, errors: validated.errors };

  const allowed = allowSubmission(ctx.ip, validated.entry.email, ctx.now, ctx.buckets);
  if (!allowed) return { ok: false, status: 429, errors: { form: RATE_ERROR } };

  const saved = await saveWaitlistEntry(validated.entry, ctx);
  if (!saved.ok) return { ok: false, status: 503, errors: { form: FORM_ERROR } };
  return { ok: true };
}

function honeypotFilled(value: unknown): boolean {
  return asText(value).trim().length > 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
