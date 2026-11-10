import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { aadFor, decryptProfile, encryptProfile, keyring, ProfileKeyError } from '../profile-crypto.ts';

type Env = Parameters<typeof keyring>[0];
/** A partial env, as keyring reads it. ProcessEnv also wants NODE_ENV, which keyring never looks at. */
const env = (e: Record<string, string>) => e as unknown as Env;
const KEY = randomBytes(32).toString('base64');
const OTHER = randomBytes(32).toString('base64');
const ring = keyring(env({ PROFILE_ENC_KEY: KEY }));
const AAD = aadFor('devnet', 'BuyerAddress1111111111111111111111111111111');
const DATA = { email: 'a@b.com', password: 'hunter2', dni: '30123456', postcode: '1425' };

describe('profile encryption', () => {
  it('round-trips, and the envelope holds no plaintext', () => {
    const env = encryptProfile(DATA, AAD, ring);
    assert.deepEqual(decryptProfile(env, AAD, ring), DATA);
    assert.ok(!JSON.stringify(env).includes('hunter2'));
    assert.ok(!JSON.stringify(env).includes('30123456'));
  });

  it('uses a fresh IV every time', () => {
    assert.notEqual(encryptProfile(DATA, AAD, ring).iv, encryptProfile(DATA, AAD, ring).iv);
  });

  it("will not open for another wallet's address", () => {
    const env = encryptProfile(DATA, AAD, ring);
    assert.throws(() => decryptProfile(env, aadFor('devnet', 'SomeoneElse1111111111111111111111111111111'), ring));
  });

  it('rejects a tampered ciphertext or tag', () => {
    const env = encryptProfile(DATA, AAD, ring);
    const flip = (b64: string) => {
      const b = Buffer.from(b64, 'base64');
      b[0] = b[0]! ^ 1;
      return b.toString('base64');
    };
    assert.throws(() => decryptProfile({ ...env, ct: flip(env.ct) }, AAD, ring));
    assert.throws(() => decryptProfile({ ...env, tag: flip(env.tag) }, AAD, ring));
  });

  it('has no fallback key', () => {
    assert.throws(() => keyring(env({})), ProfileKeyError);
    assert.throws(() => keyring(env({ PROFILE_ENC_KEY: 'c2hvcnQ=' })), ProfileKeyError);
  });

  it('reads with the old key after a rotation, and writes with the new one', () => {
    const before = encryptProfile(DATA, AAD, keyring(env({ PROFILE_ENC_KEY: OTHER })));
    const rotated = keyring(env({ PROFILE_ENC_KEY: KEY, PROFILE_ENC_KEY_OLD: OTHER }));
    assert.deepEqual(decryptProfile(before, AAD, rotated), DATA);
    assert.equal(encryptProfile(DATA, AAD, rotated).kid, ring.current.kid);
    assert.throws(() => decryptProfile(before, AAD, ring), ProfileKeyError);
  });
});
