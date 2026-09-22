import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EVENT_SOURCES, OTHER_SOURCE, SOCIAL_SOURCES, SOURCE_GROUPS, allowedSources } from '../waitlist/options.ts';
import { saveWaitlistEntry } from '../waitlist/persist.ts';
import type { RateBuckets } from '../waitlist/rate-limit.ts';
import { allowSubmission } from '../waitlist/rate-limit.ts';
import { submitWaitlist } from '../waitlist/submit.ts';
import { resetTurnstileDevLog, verifyTurnstile } from '../waitlist/turnstile.ts';
import { validateWaitlist } from '../waitlist/validate.ts';

const CREATED = '2026-09-22T12:00:00.000Z';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the whitelist header is the idle mascot plus the wordmark', () => {
  const page = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const header = page.slice(0, page.indexOf('</header>'));
  assert.match(header, /src="\/brand\/mascot-idle\.png"/);
  assert.match(header, /data-testid="whitelist-mascot"/);
  assert.match(header, /src="\/brand\/wordmark\.png"/);
  assert.match(header, /alt="Changuito"/);
  assert.match(header, /data-testid="whitelist-wordmark"/);
  assert.equal(header.includes('>Changuito<'), false);
  assert.equal(header.includes('isotipo-mascota'), false);
  assert.equal(header.includes('mascot-error'), false);

  const css = readFileSync(join(root, 'components/waitlist/waitlist.module.css'), 'utf8');
  assert.match(css, /\.wordmark \{/);
  assert.equal(css.includes('.brandName'), false);

  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(
    hash(join(root, 'public/brand/mascot-idle.png')),
    hash(join(root, '../branding/mascot/mascota-idle.png')),
  );
  assert.equal(
    hash(join(root, 'public/brand/wordmark.png')),
    hash(join(root, '../branding/logo/wordmark.png')),
  );
  // Route icon omitted on purpose. /whitelist inherits the root full-mascot favicons.
  assert.equal(existsSync(join(root, 'app/whitelist/icon.png')), false);
});

const valid = {
  name: 'Martina López',
  email: 'Martina@Ejemplo.com',
  source: 'Instagram',
  otherDetail: '',
  contactForFeedback: 'no',
  whatsapp: '',
};

test('the source list is socials, events (with Nerdearla) and Otros — no WhatsApp or Threads', () => {
  assert.deepEqual([...SOCIAL_SOURCES], [
    'Instagram',
    'X (Twitter)',
    'LinkedIn',
    'TikTok',
    'YouTube',
    'Facebook',
    'Telegram',
  ]);
  assert.deepEqual([...EVENT_SOURCES], [
    'Nerdearla',
    'AI Founder Marketplace',
    'Astra Commons: Buenos Aires',
    'BrowserStack Meetup Buenos Aires: Master Accessibility & AI in QA',
    'Founders Fit Club — Edición 03',
    'SideQuest - LOVE.exe',
  ]);
  assert.equal(EVENT_SOURCES[4].includes('—'), true);
  assert.equal(OTHER_SOURCE, 'Otros');
  assert.deepEqual(
    SOURCE_GROUPS.map((group) => group.label),
    ['Redes sociales', 'Eventos', 'Otros'],
  );
  assert.deepEqual(
    SOURCE_GROUPS.map((group) => group.id),
    ['social', 'events', 'other'],
  );
  assert.equal(allowedSources().size, 14);
  assert.equal(allowedSources().has('Nerdearla'), true);
  assert.equal(allowedSources().has('WhatsApp'), false);
  assert.equal(allowedSources().has('Threads'), false);
});

test('the waitlist form drops the single-option hint and asks about feedback contact', () => {
  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  assert.equal(form.includes('Elegí una sola opción.'), false);
  assert.match(form, /Elegí una opción/);
  assert.match(form, /¿Te gustaría que te contactemos para que nos des feedback\?/);
  assert.match(form, /WhatsApp \(opcional\)/);
  assert.match(form, /turnstile/i);
});

test('a valid signup keeps the email lowercased and drops detail unless Otros', () => {
  const result = validateWaitlist(valid, CREATED);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.email, 'martina@ejemplo.com');
  assert.equal(result.entry.name, 'Martina López');
  assert.equal(result.entry.otherDetail, undefined);
  assert.equal(result.entry.contactForFeedback, false);
  assert.equal(result.entry.whatsapp, undefined);
  assert.equal(result.entry.createdAt, CREATED);
});

test('Otros requires a short detail and stores it', () => {
  const missing = validateWaitlist({ ...valid, source: 'Otros', otherDetail: ' ' }, CREATED);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errors.otherDetail, 'Contanos dónde, en pocas palabras.');

  const ok = validateWaitlist({ ...valid, source: 'Otros', otherDetail: 'Un amigo' }, CREATED);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.entry.otherDetail, 'Un amigo');
});

test('feedback contact is required; WhatsApp is optional only when Sí', () => {
  const missing = validateWaitlist({ ...valid, contactForFeedback: '' }, CREATED);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errors.contactForFeedback, 'Decinos si podemos contactarte para feedback.');

  const noContact = validateWaitlist(
    { ...valid, contactForFeedback: 'no', whatsapp: '+54 9 11 5555 1234' },
    CREATED,
  );
  assert.equal(noContact.ok, true);
  if (!noContact.ok) return;
  assert.equal(noContact.entry.contactForFeedback, false);
  assert.equal(noContact.entry.whatsapp, undefined);

  const yesEmpty = validateWaitlist({ ...valid, contactForFeedback: 'si', whatsapp: '' }, CREATED);
  assert.equal(yesEmpty.ok, true);
  if (!yesEmpty.ok) return;
  assert.equal(yesEmpty.entry.contactForFeedback, true);
  assert.equal(yesEmpty.entry.whatsapp, undefined);

  const yesPhone = validateWaitlist(
    { ...valid, contactForFeedback: 'si', whatsapp: '+54 9 11 5555-1234' },
    CREATED,
  );
  assert.equal(yesPhone.ok, true);
  if (!yesPhone.ok) return;
  assert.equal(yesPhone.entry.whatsapp, '+54 9 11 5555-1234');

  const badPhone = validateWaitlist({ ...valid, contactForFeedback: 'si', whatsapp: '123' }, CREATED);
  assert.equal(badPhone.ok, false);
  if (badPhone.ok) return;
  assert.equal(badPhone.errors.whatsapp, 'Ingresá un WhatsApp válido, o dejalo vacío.');
});

test('rejects an unknown source, a bad email and a one-letter name', () => {
  const result = validateWaitlist(
    { name: 'A', email: 'no-es-mail', source: 'Radio', otherDetail: '', contactForFeedback: 'no', whatsapp: '' },
    CREATED,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.name, 'El nombre es muy corto.');
  assert.equal(result.errors.email, 'Ingresá un email válido.');
  assert.equal(result.errors.source, 'Elegí cómo te enteraste de nosotros.');
});

test('rate limit allows eight calls from one ip and blocks the ninth', () => {
  const buckets: RateBuckets = new Map();
  for (let i = 0; i < 8; i += 1) {
    assert.equal(allowSubmission('203.0.113.8', `persona${i}@ejemplo.com`, 1_000, buckets), true);
  }
  assert.equal(allowSubmission('203.0.113.8', 'otra@ejemplo.com', 1_000, buckets), false);
});

test('the same email is blocked after three signups', () => {
  const buckets: RateBuckets = new Map();
  assert.equal(allowSubmission('1', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('2', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('3', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('4', 'ana@ejemplo.com', 1_000, buckets), false);
});

test('webhook sink posts the entry and the optional secret', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Nerdearla',
      contactForFeedback: true,
      whatsapp: '+5491155551234',
      createdAt: CREATED,
    },
    {
      env: {
        NODE_ENV: 'production',
        WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
        WAITLIST_WEBHOOK_SECRET: 'shhh',
      },
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'webhook' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.ejemplo.com/waitlist');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), 'Bearer shhh');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    name: 'Martina López',
    email: 'martina@ejemplo.com',
    source: 'Nerdearla',
    otherDetail: null,
    contactForFeedback: true,
    whatsapp: '+5491155551234',
    createdAt: CREATED,
  });
});

test('redis sink writes one hash field and treats an existing email as saved', async () => {
  const commands: unknown[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Instagram',
      contactForFeedback: false,
      createdAt: CREATED,
    },
    {
      env: {
        NODE_ENV: 'production',
        KV_REST_API_URL: 'https://ejemplo.upstash.io',
        KV_REST_API_TOKEN: 'token',
      },
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        commands.push(JSON.parse(String(init?.body)));
        return Response.json({ result: 0 });
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'redis' });
  assert.equal(commands.length, 1);
  const command = commands[0] as string[];
  assert.equal(command[0], 'HSETNX');
  assert.equal(command[1], 'changuito:landing:waitlist');
  assert.equal(command[2], 'martina@ejemplo.com');
});

test('production without a sink does not pretend the signup was stored', async () => {
  let called = false;
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Instagram',
      contactForFeedback: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  );
  assert.deepEqual(result, { ok: false, reason: 'unconfigured' });
  assert.equal(called, false);
});

test('local dev appends a json line when no sink is configured', async () => {
  const lines: string[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Telegram',
      contactForFeedback: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'development' },
      fetch: async () => new Response(null, { status: 500 }),
      appendLine: async (line) => {
        lines.push(line);
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'file' });
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).source, 'Telegram');
});

test('a filled honeypot looks successful and does not call the sink', async () => {
  let called = false;
  const result = await submitWaitlist(
    { ...valid, company: 'https://spam.example', turnstileToken: '' },
    {
      ip: '198.51.100.4',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
});

test('submit persists a clean signup through the webhook', async () => {
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: '' },
    {
      ip: '198.51.100.9',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'development', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: true });
});

test('production submit without Turnstile keys is refused', async () => {
  resetTurnstileDevLog();
  let called = false;
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: 'ignored' },
    {
      ip: '198.51.100.10',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
  assert.equal(result.errors.form, 'No pudimos anotarte. Probá de nuevo en un rato.');
  assert.equal(called, false);
});

test('Turnstile siteverify accepts a valid token and rejects a bad one', async () => {
  resetTurnstileDevLog();
  const env = {
    NODE_ENV: 'production' as const,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET_KEY: 'secret',
  };

  const missing = await verifyTurnstile('', {
    env,
    fetch: async () => Response.json({ success: true }),
  });
  assert.deepEqual(missing, { ok: false, error: 'Confirmá que no sos un robot.' });

  const calls: string[] = [];
  const ok = await verifyTurnstile('token-ok', {
    env,
    ip: '203.0.113.1',
    fetch: async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const body = String(init?.body);
      assert.match(body, /secret=secret/);
      assert.match(body, /response=token-ok/);
      assert.match(body, /remoteip=203\.0\.113\.1/);
      return Response.json({ success: true });
    },
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(calls.length, 1);

  const bad = await verifyTurnstile('token-bad', {
    env,
    fetch: async () => Response.json({ success: false }),
  });
  assert.deepEqual(bad, { ok: false, error: 'No pudimos verificar que no seas un robot. Probá de nuevo.' });
});

test('submit with Turnstile keys verifies before saving', async () => {
  resetTurnstileDevLog();
  const urls: string[] = [];
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: 'cf-ok' },
    {
      ip: '198.51.100.11',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret',
        WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
      },
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).includes('siteverify')) return Response.json({ success: true });
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(urls[0]?.includes('siteverify'), true);
  assert.equal(urls[1], 'https://hooks.ejemplo.com/waitlist');
});

test('an http webhook that is not local is ignored', async () => {
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'YouTube',
      contactForFeedback: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'http://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: false, reason: 'unconfigured' });
});
