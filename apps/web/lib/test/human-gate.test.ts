import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clientGateDecision } from '../human-gate-ui.ts';
import {
  acceptLooksLikeBrowserFetch,
  AI_BOT_UA,
  HUMAN_COOKIE,
  humanCookieHeader,
  humanGateMode,
  mintHumanToken,
  readCookie,
  requireHuman,
  verifyHumanToken,
} from '../human-gate.ts';

const ENFORCE = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: 's',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'p',
} as const;

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
    assert.equal(AI_BOT_UA.test('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), false);
    assert.equal(AI_BOT_UA.test('Mozilla/5.0 (Macintosh) Chrome/120'), false);
  });

  it('accepts browser-like Accept headers', () => {
    assert.equal(acceptLooksLikeBrowserFetch('*/*'), true);
    assert.equal(acceptLooksLikeBrowserFetch('application/json'), true);
    assert.equal(acceptLooksLikeBrowserFetch('text/event-stream, application/json'), true);
    assert.equal(acceptLooksLikeBrowserFetch('text/html'), false);
    assert.equal(acceptLooksLikeBrowserFetch(null), false);
  });

  it('gate mode: open in non-prod without a secret, closed in prod, enforce when the secret is set', () => {
    assert.equal(humanGateMode({ NODE_ENV: 'development' }), 'open');
    assert.equal(humanGateMode({ NODE_ENV: 'production' }), 'closed');
    assert.equal(humanGateMode({ ...ENFORCE }), 'enforce');
    assert.equal(
      humanGateMode({
        NODE_ENV: 'production',
        TURNSTILE_SECRET_KEY: '  s  ',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' p ',
      }),
      'enforce',
    );
    // Site key can live only in the client bundle. The secret is what enforces.
    assert.equal(
      humanGateMode({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 's' }),
      'enforce',
    );
    assert.equal(
      humanGateMode({ NODE_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'p' }),
      'closed',
    );
  });

  it('cookie is host-only, Lax, and Secure only in production', async () => {
    const token = await mintHumanToken('s', 1_000_000, 60_000);
    const prod = humanCookieHeader(token, { NODE_ENV: 'production' });
    const dev = humanCookieHeader(token, { NODE_ENV: 'development' });

    assert.match(prod, new RegExp(`^${HUMAN_COOKIE}=`));
    assert.match(prod, /Path=\//);
    assert.match(prod, /HttpOnly/);
    assert.match(prod, /SameSite=Lax/);
    assert.match(prod, /Max-Age=43200/);
    assert.match(prod, /Secure/);
    assert.equal(prod.includes('Domain='), false);
    assert.equal(dev.includes('Secure'), false);

    const pair = prod.split(';')[0] ?? '';
    assert.equal(readCookie(pair, HUMAN_COOKIE), token);
    assert.equal(await verifyHumanToken(readCookie(pair, HUMAN_COOKIE), 's', 1_000_000), true);
  });

  it('reads a quoted cookie value', async () => {
    const token = await mintHumanToken('s', 1_000_000, 60_000);
    const header = `other=1; ${HUMAN_COOKIE}="${encodeURIComponent(token)}"; theme=light`;
    assert.equal(readCookie(header, HUMAN_COOKIE), token);
  });

  it('requireHuman accepts the cookie it would set and rejects a missing one', async () => {
    const token = await mintHumanToken('s');
    const cookie = humanCookieHeader(token, { NODE_ENV: 'production' }).split(';')[0] ?? '';
    const ok = await requireHuman(
      new Request('https://app.changuito.me/api/chat', { headers: { cookie } }),
      { ...ENFORCE },
    );
    assert.equal(ok, null);

    const missing = await requireHuman(new Request('https://app.changuito.me/api/chat'), { ...ENFORCE });
    assert.equal(missing?.status, 403);
    const body = (await missing!.json()) as { error?: string; message?: string };
    assert.equal(body.error, 'solo_humanos');
    assert.match(body.message ?? '', /Completá la verificación/);

    const closed = await requireHuman(new Request('https://app.changuito.me/api/chat'), {
      NODE_ENV: 'production',
    });
    assert.equal(closed?.status, 403);

    const open = await requireHuman(new Request('https://app.changuito.me/api/chat'), {
      NODE_ENV: 'development',
    });
    assert.equal(open, null);
  });

  it('does not unlock the shopper when production has no durable pass', () => {
    assert.deepEqual(clientGateDecision({ mode: 'open', ok: true, siteKey: '' }), { action: 'unlock' });
    assert.deepEqual(clientGateDecision({ mode: 'enforce', ok: true, siteKey: 'site' }), { action: 'unlock' });
    assert.deepEqual(clientGateDecision({ mode: 'enforce', ok: false, siteKey: 'site' }), {
      action: 'widget',
      siteKey: 'site',
    });
    // The production failure: server says closed (keys not visible) and the
    // client has no site key. Chat must stay shut.
    assert.deepEqual(clientGateDecision({ mode: 'closed', ok: false, siteKey: '' }), {
      action: 'block',
      reason: 'closed',
    });
    // A configured public key must draw Turnstile, even if the server said closed.
    assert.deepEqual(clientGateDecision({ mode: 'closed', ok: false, siteKey: 'site' }), {
      action: 'widget',
      siteKey: 'site',
    });
    assert.deepEqual(clientGateDecision({ mode: 'enforce', ok: false, siteKey: '  ' }), {
      action: 'block',
      reason: 'unconfigured',
    });
    assert.deepEqual(clientGateDecision({}), { action: 'block', reason: 'closed' });
  });
});
