import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  EXPIRING_SOON_SEC,
  type StorageState,
  type StoredSession,
  authCookies,
  describeSpan,
  isUsable,
  parseAuthenticatedUser,
  profileFromOrderForm,
  readSession,
  saveSession,
  sessionHealth,
} from '../checkout/session-store.js';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

function state(cookies: Array<Partial<StorageState['cookies'][number]>>): StorageState {
  return {
    cookies: cookies.map((c) => ({
      name: 'x', value: 'v', domain: '.dia', path: '/', expires: -1, ...c,
    })) as StorageState['cookies'],
    origins: [],
  };
}

function session(cookies: Parameters<typeof state>[0], savedAt = new Date(NOW - 3_600_000).toISOString()): StoredSession {
  return {
    meta: { savedAt, retailer: 'dia', host: 'diaonline.supermercadosdia.com.ar', account: 'me@example.com' },
    state: state(cookies),
  };
}

describe('authCookies', () => {
  it('finds the platform cookie and the per-account one', () => {
    const s = state([
      { name: 'VtexIdclientAutCookie' },
      { name: 'VtexIdclientAutCookie_ardiaprod' },
      { name: 'checkout.vtex.com' },
    ]);
    assert.deepEqual(authCookies(s).map((c) => c.name), [
      'VtexIdclientAutCookie',
      'VtexIdclientAutCookie_ardiaprod',
    ]);
  });

  it('ignores an auth cookie that has been emptied out', () => {
    assert.equal(authCookies(state([{ name: 'VtexIdclientAutCookie', value: '' }])).length, 0);
  });

  it('survives an undefined state', () => {
    assert.deepEqual(authCookies(undefined), []);
  });
});

describe('sessionHealth', () => {
  it('reports no session at all', () => {
    const h = sessionHealth(undefined, NOW);
    assert.equal(h.status, 'no_auth_cookie');
    assert.match(h.message, /link_marketplace_account/);
    assert.equal(isUsable(h), false);
  });

  it('reports a saved session with no auth cookie as an incomplete login', () => {
    const h = sessionHealth(session([{ name: 'checkout.vtex.com' }]), NOW);
    assert.equal(h.status, 'no_auth_cookie');
    assert.match(h.message, /did not complete/);
  });

  it('is ok when the cookie has hours left', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + 7200 }]),
      NOW,
    );
    assert.equal(h.status, 'ok');
    assert.equal(h.secondsLeft, 7200);
    assert.equal(isUsable(h), true);
  });

  it('takes the EARLIEST expiry, because either cookie dying logs you out', () => {
    const h = sessionHealth(
      session([
        { name: 'VtexIdclientAutCookie', expires: sec(NOW) + 86_400 },
        { name: 'VtexIdclientAutCookie_ardiaprod', expires: sec(NOW) + 600 },
      ]),
      NOW,
    );
    assert.equal(h.status, 'expiring_soon');
    assert.equal(h.secondsLeft, 600);
  });

  it('warns when less time is left than a checkout takes', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + EXPIRING_SOON_SEC - 1 }]),
      NOW,
    );
    assert.equal(h.status, 'expiring_soon');
    assert.equal(isUsable(h), false, 'must not start a payment on a session about to die');
  });

  it('treats the boundary second as still too close', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + EXPIRING_SOON_SEC }]),
      NOW,
    );
    assert.equal(h.status, 'expiring_soon');
  });

  it('reports an expired session and how long ago', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) - 7200 }]),
      NOW,
    );
    assert.equal(h.status, 'expired');
    assert.match(h.message, /expired 2\.0 h ago/);
    assert.equal(isUsable(h), false);
  });

  it('admits it cannot tell for a session cookie, rather than guessing', () => {
    const h = sessionHealth(session([{ name: 'VtexIdclientAutCookie', expires: -1 }]), NOW);
    assert.equal(h.status, 'unknown_expiry');
    // Usable, but only because the live check runs before anything is spent.
    assert.equal(isUsable(h), true);
    assert.match(h.message, /checked against the store/);
  });

  it('reports the age of the link', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + 7200 }],
        new Date(NOW - 90 * 60_000).toISOString()),
      NOW,
    );
    assert.equal(h.ageHours, 1.5);
  });

  it('does not blow up on a corrupt savedAt', () => {
    const s = session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + 7200 }], 'not-a-date');
    const h = sessionHealth(s, NOW);
    assert.equal(h.status, 'ok');
    assert.equal(h.ageHours, undefined);
  });
});

describe('describeSpan', () => {
  it('scales the unit to the magnitude', () => {
    assert.equal(describeSpan(45), '45s');
    assert.equal(describeSpan(600), '10 min');
    assert.equal(describeSpan(7200), '2.0 h');
    assert.equal(describeSpan(86_400 * 3), '3 days');
  });

  it('never prints a negative duration', () => {
    assert.equal(describeSpan(-5), '0s');
  });
});

describe('parseAuthenticatedUser', () => {
  it('accepts the documented shape', () => {
    const r = parseAuthenticatedUser({ user: 'me@example.com', userId: 'u1' });
    assert.deepEqual(r, { authenticated: true, email: 'me@example.com', userId: 'u1' });
  });

  it('accepts a userId with no email', () => {
    assert.equal(parseAuthenticatedUser({ id: 'u1' }).authenticated, true);
  });

  it('treats an empty or null body as signed out', () => {
    assert.equal(parseAuthenticatedUser(null).authenticated, false);
    assert.equal(parseAuthenticatedUser({}).authenticated, false);
    assert.equal(parseAuthenticatedUser('nope').authenticated, false);
  });
});

describe('profileFromOrderForm', () => {
  const full = {
    clientProfileData: {
      email: 'me@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      document: '30123456',
      documentType: 'dni',
      phone: '+5491100000000',
    },
  };

  it('reads name, email and DNI from the user own profile', () => {
    const p = profileFromOrderForm(full);
    assert.equal(p.authenticated, true);
    assert.equal(p.document, '30123456');
    assert.equal(p.documentType, 'dni');
    assert.equal(p.firstName, 'Ana');
  });

  it('does not call an anonymous cart authenticated just because an email was typed', () => {
    const p = profileFromOrderForm({ clientProfileData: { email: 'guest@example.com' } });
    assert.equal(p.authenticated, false, 'email alone is a guest checkout, not a login');
    assert.equal(p.email, 'guest@example.com');
  });

  it('handles a null clientProfileData', () => {
    assert.equal(profileFromOrderForm({ clientProfileData: null }).authenticated, false);
    assert.equal(profileFromOrderForm(undefined).authenticated, false);
  });
});

describe('the session on disk', () => {
  let dir: string;
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('round-trips through the encrypted vault', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sess-'));
    const path = join(dir, 'dia.session.enc');
    const s = session([{ name: 'VtexIdclientAutCookie', value: 'eyJhbGciOi', expires: sec(NOW) + 7200 }]);

    await saveSession(path, 'correct horse battery', s);
    const back = await readSession(path, 'correct horse battery');
    assert.deepEqual(back, s);
  });

  it('never writes a cookie value in the clear', async () => {
    const path = join(dir, 'clear.enc');
    await saveSession(path, 'correct horse battery', session([
      { name: 'VtexIdclientAutCookie', value: 'SUPERSECRETCOOKIEVALUE' },
    ]));
    const raw = await readFile(path, 'utf8');
    assert.ok(!raw.includes('SUPERSECRETCOOKIEVALUE'), 'session cookie leaked to disk');
    assert.ok(!raw.includes('VtexIdclientAutCookie'));
  });

  it('fails closed on the wrong passphrase', async () => {
    const path = join(dir, 'wrong.enc');
    await saveSession(path, 'correct horse battery', session([{ name: 'VtexIdclientAutCookie' }]));
    await assert.rejects(readSession(path, 'wrong passphrase entirely'));
  });

  it('returns undefined rather than throwing when nothing is linked yet', async () => {
    assert.equal(await readSession(join(dir, 'absent.enc'), 'whatever'), undefined);
  });
});
