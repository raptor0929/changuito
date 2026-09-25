import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { appContentSecurityPolicy } from '../security-headers.ts';
import { isFramableCheckout, STOREFRONT_HOSTS, STOREFRONT_ORIGINS } from '../storefront.ts';

describe('framable storefronts', () => {
  it('RULE: every storefront the agent can shop at is in frame-src', () => {
    // The failure this catches: a store added to the MCP registry and not
    // here. The shopper's cart link then loads into a frame the browser
    // blocks, with a console error nobody is reading and a blank rectangle
    // where the checkout should be.
    const csp = appContentSecurityPolicy('production', { ga: '', meta: '', clarity: '' });
    const frame = csp.split(';').find((d) => d.trim().startsWith('frame-src')) ?? '';
    for (const origin of STOREFRONT_ORIGINS) {
      assert.ok(frame.includes(origin), `${origin} is not in frame-src`);
    }
  });

  it('RULE: does not drift from the MCP retailer registry', () => {
    // Read as text, not imported: the registry lives in a package that
    // compiles to dist/, and a unit test that needs a build step first is a
    // test that gets skipped. Same reason stellar.test.ts reads the bindings.
    const registry = readFileSync(
      new URL('../../../../packages/mcp/src/adapters/registry.ts', import.meta.url),
      'utf8',
    );
    const found = new Map<string, string>();
    for (const m of registry.matchAll(/\{\s*id:\s*'([^']+)',[^}]*host:\s*'([^']+)'/g)) {
      found.set(m[1]!, m[2]!);
    }
    assert.ok(found.size >= 4, 'could not parse the registry — the shape changed');
    assert.deepEqual(
      [...found.entries()].sort(),
      Object.entries(STOREFRONT_HOSTS).sort(),
    );
  });

  it('frames a checkout URL and nothing else on the same host', () => {
    const host = STOREFRONT_HOSTS.dia;
    assert.ok(isFramableCheckout(`https://${host}/checkout/?orderFormId=abc#/cart`));
    assert.ok(isFramableCheckout(`https://${host}/checkout`));
    // The storefront root answers x-frame-options: SAMEORIGIN, so a frame
    // there is a blank box. Sending it to a tab instead is the right answer.
    assert.equal(isFramableCheckout(`https://${host}/`), false);
    assert.equal(isFramableCheckout(`https://${host}/checkoutlookalike`), false);
  });

  it('RULE: refuses an origin we did not choose', () => {
    // `handoffUrl` arrives in a tool result, and a tool result is data. A
    // model that emits an attacker's URL must not get it framed inside the
    // page the shopper is trusting.
    assert.equal(isFramableCheckout('https://evil.example/checkout/'), false);
    assert.equal(isFramableCheckout('http://diaonline.supermercadosdia.com.ar/checkout/'), false);
    assert.equal(isFramableCheckout('javascript:alert(1)'), false);
    assert.equal(isFramableCheckout('not a url'), false);
    assert.equal(isFramableCheckout(''), false);
  });

  it('still refuses to be framed itself', () => {
    // frame-src widened; frame-ancestors did not. These are opposite
    // directions and it would be easy to loosen the wrong one.
    const csp = appContentSecurityPolicy('production', { ga: '', meta: '', clarity: '' });
    assert.match(csp, /frame-ancestors 'none'/);
  });
});
