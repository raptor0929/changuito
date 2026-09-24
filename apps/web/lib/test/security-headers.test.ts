import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DEPLOYMENTS, NETWORK_IDS } from '../deployments.ts';
import { appContentSecurityPolicy, appSecurityHeaders } from '../security-headers.ts';

const none = { ga: '', meta: '', clarity: '' };
const header = (name: string, env = 'production') =>
  appSecurityHeaders(env, none).find((h) => h.key === name)?.value;

describe('shopper security headers', () => {
  it('cannot be framed by another site', () => {
    assert.match(appContentSecurityPolicy('production', none), /frame-ancestors 'none'/);
    assert.equal(header('X-Frame-Options'), 'DENY');
  });

  it('sends the same baseline as www', () => {
    assert.equal(header('X-Content-Type-Options'), 'nosniff');
    assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.match(header('Permissions-Policy') ?? '', /camera=\(\)/);
    assert.match(header('Strict-Transport-Security') ?? '', /max-age=31536000/);
    assert.equal(header('Strict-Transport-Security', 'development'), undefined);
  });

  it('allows exactly what the page talks to', () => {
    const csp = appContentSecurityPolicy('production', none);
    assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /connect-src [^;]*https:\/\/sdk\.api\.pollar\.xyz/);
    assert.match(csp, /img-src [^;]*https:\/\/\*\.vtexassets\.com/);
    assert.match(csp, /object-src 'none'/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
  });

  it('RULE: every chain host the app can be pointed at is in connect-src', () => {
    // The failure this catches: a network whose RPC host is in
    // deployments.json but not here. The browser blocks the call before it
    // leaves, and the SDK reports it as a network failure — so modo real
    // would look broken rather than misconfigured.
    const csp = appContentSecurityPolicy('production', none);
    const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
    for (const net of NETWORK_IDS) {
      for (const url of [DEPLOYMENTS[net].horizonUrl, DEPLOYMENTS[net].rpcUrl]) {
        assert.ok(connect.includes(new URL(url).origin), `${net}: ${url} is not in connect-src`);
      }
    }
  });

  it('names an analytics vendor only when its id is set', () => {
    assert.doesNotMatch(appContentSecurityPolicy('production', none), /googletagmanager/);
    assert.match(appContentSecurityPolicy('production', { ...none, ga: 'G-TEST123' }), /googletagmanager/);
  });

  it('is wired into next.config, with X-Powered-By off', () => {
    const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
    assert.match(config, /poweredByHeader:\s*false/);
    assert.match(config, /appSecurityHeaders\(\)/);
  });
});
