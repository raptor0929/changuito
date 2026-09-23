import { codeForMessage, firstFieldMessage } from '../../../lib/waitlist/messages.ts';
import { submitWaitlist } from '../../../lib/waitlist/submit.ts';

export const runtime = 'nodejs';

const TOO_BIG = { ok: false, errors: { form: 'El mensaje es muy largo.' } };
const UNREADABLE = { ok: false, errors: { form: 'No pudimos leer el formulario.' } };

type BodyFields = {
  name: unknown;
  email: unknown;
  source: unknown;
  otherDetail: unknown;
  whatsapp: unknown;
  whatsappGroup: unknown;
  company: unknown;
  turnstileToken: unknown;
};

export async function POST(request: Request) {
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const result = await submitWaitlist(parsed.body, {
    ip: clientIp(request),
    now: Date.now(),
    env: process.env,
    fetch,
    userAgent: request.headers.get('user-agent') ?? undefined,
  });

  if (parsed.formPost) {
    const url = new URL('/whitelist', request.url);
    if (result.ok) url.searchParams.set('estado', 'listo');
    else if (result.status === 503) url.searchParams.set('estado', 'nuestro');
    else if (result.status === 429) url.searchParams.set('estado', 'espera');
    else {
      url.searchParams.set('estado', 'datos');
      const code = codeForMessage(firstFieldMessage(result.errors));
      if (code) url.searchParams.set('campo', code);
    }
    return Response.redirect(url, 303);
  }

  if (result.ok) return Response.json({ ok: true });
  return Response.json({ ok: false, errors: result.errors }, { status: result.status });
}

async function readBody(
  request: Request,
): Promise<{ ok: true; formPost: boolean; body: BodyFields } | { ok: false; response: Response }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData();
    return {
      ok: true,
      formPost: true,
      body: {
        name: form.get('name'),
        email: form.get('email'),
        source: form.get('source'),
        otherDetail: form.get('otherDetail'),
        whatsapp: form.get('whatsapp'),
        whatsappGroup: form.get('whatsappGroup'),
        company: form.get('company'),
        turnstileToken: form.get('cf-turnstile-response') ?? form.get('turnstileToken'),
      },
    };
  }

  const text = await request.text();
  if (text.length > 8000) return { ok: false, response: Response.json(TOO_BIG, { status: 413 }) };
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
        source: body.source,
        otherDetail: body.otherDetail,
        whatsapp: body.whatsapp,
        whatsappGroup: body.whatsappGroup,
        company: body.company,
        turnstileToken: body.turnstileToken ?? body['cf-turnstile-response'],
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
