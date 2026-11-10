import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCheckoutServiceCallback } from '../service-callback.ts';

describe('checkout service callback gate', () => {
  it('admits only the two supported methods on the exact callback path', () => {
    assert.equal(isCheckoutServiceCallback('/api/checkout/events', 'GET'), true);
    assert.equal(isCheckoutServiceCallback('/api/checkout/events', 'POST'), true);
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      assert.equal(isCheckoutServiceCallback('/api/checkout/events', method), false);
    }
  });

  it('keeps shopper APIs and callback-like paths behind the human gate', () => {
    for (const path of ['/api/checkout/start', '/api/checkout/viewer', '/api/checkout/open',
      '/api/checkout/events/extra', '/api/checkout/event', '/api/checkout/events/']) {
      assert.equal(isCheckoutServiceCallback(path, 'POST'), false);
    }
  });

  it('still requires service authentication inside both callback handlers', async () => {
    const { GET, POST } = await import('../../app/api/checkout/events/route.ts');
    const url = 'https://app.example.test/api/checkout/events';
    assert.equal((await GET(new Request(url))).status, 401);
    assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  });
});
