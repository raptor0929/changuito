import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVENT_SOURCES, OTHER_SOURCE, SOCIAL_SOURCES, SOURCE_GROUPS, allowedSources } from '../waitlist/options.ts';
import { saveWaitlistEntry } from '../waitlist/persist.ts';
import type { RateBuckets } from '../waitlist/rate-limit.ts';
import { allowSubmission } from '../waitlist/rate-limit.ts';
import { submitWaitlist } from '../waitlist/submit.ts';
import { validateWaitlist } from '../waitlist/validate.ts';

const CREATED = '2026-09-22T12:00:00.000Z';

const valid = {
  name: 'Martina López',
  email: 'Martina@Ejemplo.com',
  source: 'Instagram',
  otherDetail: '',
};

test('the source list is the socials, Nerdearla, the five Luma events and Otros', () => {
  assert.deepEqual([...SOCIAL_SOURCES], [
    'Instagram',
    'X (Twitter)',
    'LinkedIn',
    'TikTok',
    'YouTube',
    'Facebook',
    'WhatsApp',
    'Telegram',
    'Threads',
  ]);
  assert.deepEqual([...EVENT_SOURCES], [
    'AI Founder Marketplace',
    'Astra Commons: Buenos Aires',
    'BrowserStack Meetup Buenos Aires: Master Accessibility & AI in QA',
    'Founders Fit Club — Edición 03',
    'SideQuest - LOVE.exe',
  ]);
  assert.equal(EVENT_SOURCES[3].includes('—'), true);
  assert.equal(OTHER_SOURCE, 'Otros');
  assert.deepEqual(
    SOURCE_GROUPS.map((group) => group.label),
    ['Redes sociales', 'Nerdearla', 'Eventos', 'Otros'],
  );
  assert.equal(allowedSources().size, 16);
  assert.equal(allowedSources().has('Nerdearla'), true);
});

test('a valid signup keeps the email lowercased and drops detail unless Otros', () => {
  const result = validateWaitlist(valid, CREATED);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.email, 'martina@ejemplo.com');
  assert.equal(result.entry.name, 'Martina López');
  assert.equal(result.entry.otherDetail, undefined);
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

test('rejects an unknown source, a bad email and a one-letter name', () => {
  const result = validateWaitlist(
    { name: 'A', email: 'no-es-mail', source: 'Radio', otherDetail: '' },
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
      source: 'Threads',
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
  assert.equal(JSON.parse(lines[0]).source, 'Threads');
});

test('a filled honeypot looks successful and does not call the sink', async () => {
  let called = false;
  const result = await submitWaitlist(
    { ...valid, company: 'https://spam.example' },
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
    { ...valid, company: '' },
    {
      ip: '198.51.100.9',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: true });
});

test('an http webhook that is not local is ignored', async () => {
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'YouTube',
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'http://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: false, reason: 'unconfigured' });
});
