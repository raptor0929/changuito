import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SEVERITIES } from '../bug-report/options.ts';
import { saveBugReport } from '../bug-report/persist.ts';
import { submitBugReport } from '../bug-report/submit.ts';
import { validateBugReport, type BugReportEntry } from '../bug-report/validate.ts';

const CREATED = '2026-09-22T12:00:00.000Z';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const valid = {
  name: 'Martina López',
  email: 'Martina@Ejemplo.com',
  description: 'Apreté pagar y la pantalla quedó en blanco.',
  context: '',
  severity: '',
};

test('a valid report lowercases the email and drops empty optional fields', () => {
  const result = validateBugReport(valid, CREATED);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.email, 'martina@ejemplo.com');
  assert.equal(result.entry.name, 'Martina López');
  assert.equal(result.entry.description, valid.description);
  assert.equal(result.entry.context, undefined);
  assert.equal(result.entry.severity, undefined);
  assert.equal(result.entry.createdAt, CREATED);
});

test('optional context and severity are kept when they are real', () => {
  const result = validateBugReport(
    {
      ...valid,
      context: 'https://app.changuito.me después de buscar leche',
      severity: 'No puedo seguir',
    },
    CREATED,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.context, 'https://app.changuito.me después de buscar leche');
  assert.equal(result.entry.severity, 'No puedo seguir');
  assert.deepEqual([...SEVERITIES], ['Molesta un poco', 'Me frena', 'No puedo seguir']);
});

test('name, email and description are required', () => {
  const result = validateBugReport(
    { name: '', email: 'no-es-mail', description: 'corto', context: 'x', severity: 'alta' },
    CREATED,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.name, 'Completá tu nombre.');
  assert.equal(result.errors.email, 'Ingresá un email válido.');
  assert.equal(result.errors.description, 'Contanos un poco más.');
  assert.equal(result.errors.context, 'Si lo completás, contanos un poco más.');
  assert.equal(result.errors.severity, 'Elegí una opción de la lista.');
});

test('production without a webhook accepts the report and logs it', async () => {
  const logs: BugReportEntry[] = [];
  let called = false;
  const result = await submitBugReport(
    { ...valid, company: '' },
    {
      ip: '198.51.100.20',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
      log: (entry) => logs.push(entry),
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].email, 'martina@ejemplo.com');
  assert.equal(logs[0].description, valid.description);
});

test('webhook sink posts the report and the optional secret', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const saved = validateBugReport(
    { ...valid, context: 'En el carrito', severity: 'Me frena' },
    CREATED,
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const result = await saveBugReport(saved.entry, {
    env: {
      NODE_ENV: 'production',
      BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs',
      BUG_REPORT_WEBHOOK_SECRET: 'shhh',
    },
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(result, { ok: true, sink: 'webhook' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.ejemplo.com/bugs');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), 'Bearer shhh');
  assert.equal(headers.get('x-changuito-bug-report'), '1');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    name: 'Martina López',
    email: 'martina@ejemplo.com',
    description: valid.description,
    context: 'En el carrito',
    severity: 'Me frena',
    createdAt: CREATED,
  });
});

test('a failed webhook does not pretend the report was delivered', async () => {
  const result = await submitBugReport(
    { ...valid, company: '' },
    {
      ip: '198.51.100.21',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs' },
      fetch: async () => new Response(null, { status: 502 }),
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
});

test('an http webhook that is not local is ignored and the report is still logged', async () => {
  const logs: BugReportEntry[] = [];
  const saved = validateBugReport(valid, CREATED);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const result = await saveBugReport(saved.entry, {
    env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'http://hooks.ejemplo.com/bugs' },
    fetch: async () => new Response(null, { status: 200 }),
    log: (entry) => logs.push(entry),
  });
  assert.deepEqual(result, { ok: true, sink: 'log' });
  assert.equal(logs.length, 1);
});

test('a filled honeypot looks successful and does not log or call the webhook', async () => {
  const logs: BugReportEntry[] = [];
  let called = false;
  const result = await submitBugReport(
    { ...valid, company: 'https://spam.example' },
    {
      ip: '198.51.100.4',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
      log: (entry) => logs.push(entry),
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
  assert.equal(logs.length, 0);
});

test('the report page shows the error mascot and the home hero does not', () => {
  const page = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const form = readFileSync(join(root, 'components/bug-report/bug-report-form.tsx'), 'utf8');
  const home = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');

  assert.match(page, /src="\/brand\/mascot-error\.png"/);
  assert.match(page, /Contanos qué pasó/);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(page.includes('mascot-exito'), false);
  assert.equal(page.includes('mascot-idle'), false);
  assert.equal(form.includes('mascot-exito'), false);
  assert.equal(form.includes('animacion-busqueda'), false);
  assert.match(home, /href="\/reportarbug"/);
  assert.match(home, /Reportar un bug/);
  assert.equal(home.includes('mascot-error'), false);
  assert.equal(home.includes('/brand/animacion-busqueda.gif'), true);

  const mascot = readFileSync(join(root, 'public/brand/mascot-error.png'));
  const idle = readFileSync(join(root, 'public/brand/mascot-idle.png'));
  assert.equal(mascot.readUInt32BE(16), 397);
  assert.equal(mascot.readUInt32BE(20), 583);
  assert.equal(idle.readUInt32BE(16), 397);
  assert.equal(idle.readUInt32BE(20), 583);
  assert.notEqual(createHash('sha256').update(mascot).digest('hex'), createHash('sha256').update(idle).digest('hex'));
  assert.equal(
    createHash('sha256').update(mascot).digest('hex'),
    '960aa1ad5028b53a0ef6bd6deaaa4f4984ede84c0c95cd6a731672d1517dc674',
  );

  const ui = `${page}\n${form}\n${css}`;
  assert.equal(ui.includes('\u2014'), false);
  assert.equal(ui.includes('\u2013'), false);
});
