import { submitBugReport } from '../../../lib/bug-report/submit.ts';

export const runtime = 'nodejs';

const TOO_BIG = { ok: false, errors: { form: 'El mensaje es muy largo.' } };
const UNREADABLE = { ok: false, errors: { form: 'No pudimos leer el formulario.' } };

export async function POST(request: Request) {
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const result = await submitBugReport(parsed.body, {
    ip: clientIp(request),
    now: Date.now(),
    env: process.env,
    fetch,
  });

  if (parsed.formPost) {
    const estado = result.ok ? 'listo' : 'error';
    return Response.redirect(new URL(`/reportarbug?estado=${estado}`, request.url), 303);
  }

  if (result.ok) return Response.json({ ok: true });
  return Response.json({ ok: false, errors: result.errors }, { status: result.status });
}

async function readBody(request: Request): Promise<
  | {
      ok: true;
      formPost: boolean;
      body: {
        name: unknown;
        email: unknown;
        description: unknown;
        context: unknown;
        severity: unknown;
        company: unknown;
      };
    }
  | { ok: false; response: Response }
> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData();
    return {
      ok: true,
      formPost: true,
      body: {
        name: form.get('name'),
        email: form.get('email'),
        description: form.get('description'),
        context: form.get('context'),
        severity: form.get('severity'),
        company: form.get('company'),
      },
    };
  }

  const text = await request.text();
  if (text.length > 16_000) return { ok: false, response: Response.json(TOO_BIG, { status: 413 }) };
  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== 'object') {
      return { ok: false, response: Response.json(UNREADABLE, { status: 400 }) };
    }
    const body = payload as Record<string, unknown>;
    return {
      ok: true,
      formPost: false,
      body: {
        name: body.name,
        email: body.email,
        description: body.description,
        context: body.context,
        severity: body.severity,
        company: body.company,
      },
    };
  } catch {
    return { ok: false, response: Response.json(UNREADABLE, { status: 400 }) };
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || 'unknown';
}
