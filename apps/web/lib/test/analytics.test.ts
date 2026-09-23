import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  analyticsConfigured,
  emitAnalytics,
  errorCode,
  readAnalyticsIds,
  sanitizeProps,
  type AnalyticsSink,
} from '../analytics.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const ids = readAnalyticsIds({
  ga: 'G-TEST1234',
  meta: '1234567890',
  clarity: 'abc123def',
});

test('missing or malformed ids configure nothing', () => {
  assert.equal(analyticsConfigured(readAnalyticsIds({})), false);
  assert.equal(analyticsConfigured(readAnalyticsIds({ ga: 'UA-1', meta: 'pixel', clarity: 'bad id' })), false);
  const sink: AnalyticsSink = {
    gtag: () => {
      throw new Error('gtag should not run');
    },
    fbq: () => {
      throw new Error('fbq should not run');
    },
    clarity: () => {
      throw new Error('clarity should not run');
    },
  };
  emitAnalytics('session_start', { code: 'x' }, readAnalyticsIds({}), sink);
});

test('props stay coarse', () => {
  assert.deepEqual(
    sanitizeProps({
      code: 'local_model',
      flow: 'faucet',
      email: 'a@b.c',
      message: 'hola',
      amount: 50,
      name: 'Ana',
      note: 'a long free text note that must not be sent anywhere',
    }),
    { code: 'local_model', flow: 'faucet' },
  );
  assert.equal(sanitizeProps({ message: 'secret' }), undefined);
});

test('product events use Meta standard names and skip CompleteRegistration', () => {
  const meta: string[] = [];
  const ga: string[] = [];
  const sink: AnalyticsSink = {
    gtag: (_command, name) => {
      ga.push(name);
    },
    fbq: (command, name) => {
      meta.push(`${command}:${name}`);
    },
    clarity: () => {},
  };
  emitAnalytics('search_submit', undefined, ids, sink);
  emitAnalytics('payment_success', { flow: 'checkout' }, ids, sink);
  emitAnalytics('login_success', undefined, ids, sink);
  emitAnalytics('session_start', undefined, ids, sink);
  assert.deepEqual(ga, ['search_submit', 'payment_success', 'login_success', 'session_start']);
  assert.deepEqual(meta, [
    'track:Search',
    'track:Purchase',
    'trackCustom:login_success',
    'trackCustom:session_start',
  ]);
  assert.equal(meta.some((name) => name.includes('CompleteRegistration')), false);
});

test('known UI errors become codes, not the sentence', () => {
  assert.equal(errorCode('Ollama tardó demasiado en arrancar. Esperá.'), 'local_model');
  assert.equal(errorCode('El modelo local falló (timeout). Revisá Ollama.'), 'local_model');
  assert.equal(errorCode('Se cortó la conexión antes de terminar. Probá de nuevo.'), 'connection');
  assert.equal(errorCode('Para seguir, iniciá sesión. Así podemos anotarte.'), 'login_required');
  assert.equal(errorCode('algo distinto'), 'unknown');
});

test('the shopper layout loads analytics and stays quiet without ids', () => {
  const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
  const ui = readFileSync(join(root, 'components/Analytics.tsx'), 'utf8');
  const env = readFileSync(join(root, '.env.example'), 'utf8');
  assert.match(layout, /<Analytics \/>/);
  assert.match(ui, /if \(!analyticsConfigured\(ids\)\) return null/);
  assert.match(ui, /fbq\('track','PageView'\)/);
  assert.equal(ui.includes("fbq('track','CompleteRegistration')"), false);
  assert.match(env, /NEXT_PUBLIC_GA_MEASUREMENT_ID=/);
  assert.match(env, /NEXT_PUBLIC_META_PIXEL_ID=/);
  assert.match(env, /NEXT_PUBLIC_CLARITY_PROJECT_ID=/);
});
