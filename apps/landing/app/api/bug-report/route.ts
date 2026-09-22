import { bytesToBase64, clientFileError, MAX_JSON_CHARS, totalTooBigMessage } from '../../../lib/bug-report/attachments.ts';
import { submitBugReport } from '../../../lib/bug-report/submit.ts';

export const runtime = 'nodejs';

const UNREADABLE = { ok: false, errors: { form: 'No pudimos leer el formulario.' } };

export async function POST(request: Request) {
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const result = await submitBugReport(parsed.body, {
    ip: clientIp(request),
    now: Date.now(),
    userAgent: request.headers.get('user-agent') ?? undefined,
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
        adjuntos: unknown;
      };
    }
  | { ok: false; response: Response }
> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData();
    const files = await filesFromForm(form);
    if (!files.ok) return { ok: false, response: Response.json({ ok: false, errors: { attachments: files.error } }, { status: 400 }) };
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
        adjuntos: files.adjuntos,
      },
    };
  }

  const text = await request.text();
  if (text.length > MAX_JSON_CHARS) {
    return { ok: false, response: Response.json({ ok: false, errors: { attachments: totalTooBigMessage() } }, { status: 413 }) };
  }
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
        adjuntos: body.adjuntos ?? body.attachments,
      },
    };
  } catch {
    return { ok: false, response: Response.json(UNREADABLE, { status: 400 }) };
  }
}

async function filesFromForm(
  form: FormData,
): Promise<{ ok: true; adjuntos: { name: string; mimeType: string; base64: string }[] } | { ok: false; error: string }> {
  const parts = form.getAll('attachments').filter((part): part is File => {
    return part instanceof File && (part.size > 0 || part.name.trim().length > 0);
  });

  let count = 0;
  let bytes = 0;
  for (const part of parts) {
    const problem = clientFileError({ name: part.name, type: part.type, size: part.size }, { count, bytes });
    if (problem) return { ok: false, error: problem };
    count += 1;
    bytes += part.size;
  }

  const adjuntos = [];
  for (const part of parts) {
    adjuntos.push({
      name: part.name,
      mimeType: part.type,
      base64: bytesToBase64(new Uint8Array(await part.arrayBuffer())),
    });
  }
  return { ok: true, adjuntos };
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || 'unknown';
}
