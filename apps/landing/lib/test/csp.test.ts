import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { landingContentSecurityPolicy, landingSecurityHeaders, TURNSTILE_ORIGIN } from '../csp.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const ANALYTICS_KEYS = [
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'NEXT_PUBLIC_CLARITY_PROJECT_ID',
] as const;

function withEnv(
  values: Partial<Record<(typeof ANALYTICS_KEYS)[number], string | undefined>>,
  run: () => void,
) {
  const previous = Object.fromEntries(ANALYTICS_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ANALYTICS_KEYS) {
    if (!(key in values)) continue;
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    run();
  } finally {
    for (const key of ANALYTICS_KEYS) {
      if (!(key in values)) continue;
      const prior = previous[key];
      if (typeof prior === 'string') process.env[key] = prior;
      else delete process.env[key];
    }
  }
}

function header(name: string, headers: { key: string; value: string }[]): string {
  const found = headers.find((item) => item.key === name);
  assert.ok(found, name);
  return found.value;
}

function sources(policy: string, name: string): string[] {
  const directive = policy.split('; ').find((part) => part === name || part.startsWith(`${name} `));
  assert.ok(directive, name);
  return directive.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

test('production CSP keeps analytics and lets Turnstile render', () => {
  withEnv(
    {
      NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TEST1234',
      NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
      NEXT_PUBLIC_CLARITY_PROJECT_ID: 'abc123xyz',
    },
    () => {
      const policy = landingContentSecurityPolicy('production');
      assert.equal(
        policy,
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://www.clarity.ms https://scripts.clarity.ms https://challenges.cloudflare.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com https://www.facebook.com https://www.clarity.ms https://c.clarity.ms",
          "font-src 'self'",
          "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://www.facebook.com https://connect.facebook.net https://www.clarity.ms https://*.clarity.ms https://challenges.cloudflare.com",
          'frame-src https://challenges.cloudflare.com',
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; '),
      );

      const headers = landingSecurityHeaders('production');
      assert.equal(header('Content-Security-Policy', headers), policy);
      assert.equal(header('X-Frame-Options', headers), 'DENY');
      assert.equal(header('Strict-Transport-Security', headers), 'max-age=31536000; includeSubDomains');
      assert.equal(sources(policy, 'frame-src').includes('*'), false);
      assert.equal(sources(policy, 'frame-src').includes("'none'"), false);
      assert.equal(sources(policy, 'script-src').includes("'unsafe-eval'"), false);
      assert.equal(policy.includes('challenges.fed.cloudflare.com'), false);
      assert.equal(policy.includes('challenges.cloudflare-cn.com'), false);
      assert.equal(policy.includes('challenges-staging.cloudflare.com'), false);
    },
  );
});

test('dev CSP still allows the overlay and Turnstile, without analytics hosts', () => {
  withEnv(
    {
      NEXT_PUBLIC_GA_MEASUREMENT_ID: undefined,
      NEXT_PUBLIC_META_PIXEL_ID: undefined,
      NEXT_PUBLIC_CLARITY_PROJECT_ID: undefined,
    },
    () => {
      const policy = landingContentSecurityPolicy('development');
      assert.deepEqual(sources(policy, 'script-src'), [
        "'self'",
        "'unsafe-inline'",
        "'wasm-unsafe-eval'",
        "'unsafe-eval'",
        TURNSTILE_ORIGIN,
      ]);
      assert.deepEqual(sources(policy, 'connect-src'), ["'self'", 'ws:', 'wss:', TURNSTILE_ORIGIN]);
      assert.deepEqual(sources(policy, 'frame-src'), [TURNSTILE_ORIGIN]);
      assert.deepEqual(sources(policy, 'frame-ancestors'), ["'none'"]);
      assert.equal(policy.includes('googletagmanager'), false);
      assert.equal(policy.includes('facebook'), false);
      assert.equal(policy.includes('clarity.ms'), false);
      assert.equal(policy.includes('upgrade-insecure-requests'), false);
      const headers = landingSecurityHeaders('development');
      assert.equal(
        headers.some((item) => item.key === 'Strict-Transport-Security'),
        false,
      );
      assert.equal(header('X-Frame-Options', headers), 'DENY');
    },
  );
});

test('the whitelist script host is the one origin the CSP allows', () => {
  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  assert.match(form, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(config, /landingSecurityHeaders/);
  assert.equal(config.includes("frame-src 'none'"), false);
  assert.equal(TURNSTILE_ORIGIN, 'https://challenges.cloudflare.com');
});
