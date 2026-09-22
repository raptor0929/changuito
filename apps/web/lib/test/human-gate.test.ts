import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptLooksLikeBrowserFetch,
  AI_BOT_UA,
  humanGateMode,
  mintHumanToken,
  verifyHumanToken,
} from '../human-gate.ts';

describe('human-gate', () => {
  it('mints and verifies a token', async () => {
    const secret = 'test-secret-key';
    const token = await mintHumanToken(secret, 1_000_000, 60_000);
    assert.equal(await verifyHumanToken(token, secret, 1_000_000), true);
    assert.equal(await verifyHumanToken(token, secret, 1_100_000), false);
    assert.equal(await verifyHumanToken(token, 'other', 1_000_000), false);
  });

  it('detects AI bot user-agents', () => {
    assert.equal(AI_BOT_UA.test('Mozilla/5.0 GPTBot'), true);
    assert.equal(AI_BOT_UA.test('ClaudeBot/1.0'), true);
    assert.equal(AI_BOT_UA.test('Mozilla/5.0 (Macintosh) Chrome/120'), false);
  });

  it('accepts browser-like Accept headers', () => {
    assert.equal(acceptLooksLikeBrowserFetch('*/*'), true);
    assert.equal(acceptLooksLikeBrowserFetch('application/json'), true);
    assert.equal(acceptLooksLikeBrowserFetch('text/html'), false);
    assert.equal(acceptLooksLikeBrowserFetch(null), false);
  });

  it('gate mode: open in non-prod without keys', () => {
    assert.equal(humanGateMode({ NODE_ENV: 'development' }), 'open');
    assert.equal(humanGateMode({ NODE_ENV: 'production' }), 'closed');
    assert.equal(
      humanGateMode({
        NODE_ENV: 'production',
        TURNSTILE_SECRET_KEY: 's',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'p',
      }),
      'enforce',
    );
  });
});
