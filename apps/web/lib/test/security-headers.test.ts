import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

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
