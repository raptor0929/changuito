import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAbsolute } from 'node:path';

import { ConfigError, bool, describeConfig, loadConfig, num, requirePassphrase } from '../config.js';

const MIN = { VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/secrets-test' };

describe('bool', () => {
  it('accepts the usual spellings of true and false', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      assert.equal(bool({ X: v }, 'X', false), true, v);
    }
    for (const v of ['0', 'false', 'no', 'off', '']) {
      assert.equal(bool({ X: v }, 'X', true), false, v);
    }
  });

  it('falls back when unset', () => {
    assert.equal(bool({}, 'X', true), true);
  });

  it('refuses a value it cannot interpret rather than guessing', () => {
    // "maybe" silently meaning false is how a live-spending guard gets bypassed.
    assert.throws(() => bool({ X: 'maybe' }, 'X', false), ConfigError);
  });
});

describe('num', () => {
  it('parses and range-checks', () => {
    assert.equal(num({ X: '0.2' }, 'X', 0.15, 0, 1), 0.2);
    assert.throws(() => num({ X: '2' }, 'X', 0.15, 0, 1), /between 0 and 1/);
    assert.throws(() => num({ X: 'abc' }, 'X', 0.15, 0, 1), /must be a number/);
  });

  it('treats blank as unset', () => {
    assert.equal(num({ X: '  ' }, 'X', 7, 0, 10), 7);
  });
});

describe('loadConfig', () => {
  it('defaults to Día and derives its host', () => {
    const c = loadConfig(MIN);
    assert.equal(c.retailer, 'dia');
    assert.equal(c.host, 'diaonline.supermercadosdia.com.ar');
  });

  it('rejects a retailer it has no host for', () => {
    assert.throws(() => loadConfig({ ...MIN, RETAILER: 'coto' }), /Unknown retailer/);
  });

  it('derives absolute secret paths from the secrets dir', () => {
    const c = loadConfig(MIN);
    assert.ok(isAbsolute(c.sessionVaultPath));
    assert.match(c.sessionVaultPath, /dia\.session\.enc$/);
    assert.match(c.keystorePath, /wallet\.keystore\.json$/);
  });

  it('names the session vault after the retailer, so two stores cannot collide', () => {
    const a = loadConfig(MIN).sessionVaultPath;
    const b = loadConfig({ ...MIN, RETAILER: 'carrefour' }).sessionVaultPath;
    assert.notEqual(a, b);
  });

  it('refuses to start with a live key unless live spending is allowed', () => {
    assert.throws(
      () => loadConfig({ ...MIN, VYRION_API_KEY: 'sk_live_x' }),
      /ALLOW_LIVE is not set/,
    );
    assert.doesNotThrow(() => loadConfig({ ...MIN, VYRION_API_KEY: 'sk_live_x', ALLOW_LIVE: '1' }));
  });

  it('defaults the FX buffer to 15% and clamps it to a sane range', () => {
    assert.equal(loadConfig(MIN).fx.buffer, 0.15);
    assert.equal(loadConfig({ ...MIN, FX_BUFFER: '0.3' }).fx.buffer, 0.3);
    assert.throws(() => loadConfig({ ...MIN, FX_BUFFER: '5' }), /FX_BUFFER/);
  });

  it('only accepts an FX override inside the sane-rate window', () => {
    assert.equal(loadConfig({ ...MIN, ARS_PER_USD: '1450' }).fx.override, 1450);
    assert.throws(() => loadConfig({ ...MIN, ARS_PER_USD: '1.5' }), /ARS_PER_USD/);
  });

  it('turns Jev on when a key is present and off when it is not', () => {
    assert.equal(loadConfig(MIN).jev.enabled, false);
    assert.equal(loadConfig({ ...MIN, TYPESAFE_API_KEY: 'k' }).jev.enabled, true);
  });

  it('refuses to claim Jev is enabled without a key to call it with', () => {
    assert.throws(() => loadConfig({ ...MIN, JEV_ENABLED: 'true' }), /TYPESAFE_API_KEY/);
  });

  it('lets Jev be switched off even when a key is configured', () => {
    const c = loadConfig({ ...MIN, TYPESAFE_API_KEY: 'k', JEV_ENABLED: 'false' });
    assert.equal(c.jev.enabled, false);
  });

  it('rejects a funding asset Vyrion does not support — including Stellar', () => {
    assert.throws(() => loadConfig({ ...MIN, FUNDING_ASSET: 'xlm' }), /no Stellar/);
  });

  it('defaults the MCC whitelist to grocery categories', () => {
    assert.ok(loadConfig(MIN).vyrion.allowedCategories.includes('5411'));
  });

  it('parses a custom MCC list, ignoring whitespace and blanks', () => {
    const c = loadConfig({ ...MIN, ALLOWED_MCC: '5411, 5499 ,' });
    assert.deepEqual(c.vyrion.allowedCategories, ['5411', '5499']);
  });

  it('converts the loop budget from minutes to milliseconds', () => {
    assert.equal(loadConfig({ ...MIN, MAX_MINUTES: '2' }).browser.maxMs, 120_000);
  });

  it('is headless unless told otherwise', () => {
    assert.equal(loadConfig(MIN).browser.headless, true);
    assert.equal(loadConfig({ ...MIN, HEADLESS: '0' }).browser.headless, false);
  });
});

describe('describeConfig', () => {
  it('never prints the API key itself', () => {
    const key = 'sk_test_supersecretvalue';
    const text = describeConfig(loadConfig({ ...MIN, VYRION_API_KEY: key }));
    assert.ok(!text.includes(key), text);
    assert.match(text, /vyrion key:\s+set \(sandbox\)/);
  });

  it('shouts when the key is live', () => {
    const text = describeConfig(loadConfig({ ...MIN, VYRION_API_KEY: 'sk_live_x', ALLOW_LIVE: '1' }));
    assert.match(text, /\(LIVE\)/);
  });

  it('says a missing key is missing instead of printing an empty value', () => {
    assert.match(describeConfig(loadConfig({ SECRETS_DIR: '/tmp/x' })), /NOT SET/);
  });

  it('warns that a non-EVM funding asset cannot be signed for', () => {
    const text = describeConfig(loadConfig({ ...MIN, FUNDING_ASSET: 'btc' }));
    assert.match(text, /cannot sign this/);
  });

  it('says which classifier layers are active when Jev is off', () => {
    assert.match(describeConfig(loadConfig(MIN)), /layers 1, 2 and 4 only/);
  });
});

describe('requirePassphrase', () => {
  it('returns the passphrase when it is long enough', () => {
    assert.equal(requirePassphrase('SESSION_PASSPHRASE', { SESSION_PASSPHRASE: 'longenough' }), 'longenough');
  });

  it('refuses a short one, naming what it protects', () => {
    assert.throws(
      () => requirePassphrase('SESSION_PASSPHRASE', { SESSION_PASSPHRASE: 'abc' }),
      /supermarket session/,
    );
    assert.throws(
      () => requirePassphrase('WALLET_PASSPHRASE', {}),
      /wallet keystore/,
    );
  });
});
