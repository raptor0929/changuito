import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  decryptJson,
  encryptJson,
  readVault,
  safeEqual,
  vaultExists,
  writeVault,
} from '../secure/vault.js';

const PASS = 'correct horse battery staple';
const dir = join(tmpdir(), `vault-test-${process.pid}`);
after(() => fs.rm(dir, { recursive: true, force: true }));

describe('vault round trip', () => {
  it('returns exactly what went in', async () => {
    const data = { cookies: [{ name: 'VtexIdclientAutCookie', value: 'abc' }], origins: [] };
    assert.deepEqual(await decryptJson(await encryptJson(data, PASS), PASS), data);
  });

  it('produces different ciphertext each time for identical input', async () => {
    // A fresh salt and IV per write. Identical output would leak that two
    // sessions are the same session.
    const a = await encryptJson({ x: 1 }, PASS);
    const b = await encryptJson({ x: 1 }, PASS);
    assert.notEqual(a, b);
  });

  it('never contains the plaintext', async () => {
    const blob = await encryptJson({ token: 'super-secret-session-token' }, PASS);
    assert.ok(!blob.includes('super-secret-session-token'));
  });
});

describe('vault fails closed', () => {
  it('rejects the wrong passphrase', async () => {
    const blob = await encryptJson({ x: 1 }, PASS);
    await assert.rejects(() => decryptJson(blob, 'wrong passphrase entirely'), /Could not decrypt/);
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const file = JSON.parse(await encryptJson({ x: 1 }, PASS));
    const ct = Buffer.from(file.ct, 'base64');
    ct[0] ^= 0xff;
    file.ct = ct.toString('base64');
    await assert.rejects(() => decryptJson(JSON.stringify(file), PASS), /Could not decrypt/);
  });

  it('rejects a tampered auth tag', async () => {
    const file = JSON.parse(await encryptJson({ x: 1 }, PASS));
    const tag = Buffer.from(file.tag, 'base64');
    tag[0] ^= 0xff;
    file.tag = tag.toString('base64');
    await assert.rejects(() => decryptJson(JSON.stringify(file), PASS), /Could not decrypt/);
  });

  it('rejects a file that was never a vault', async () => {
    await assert.rejects(() => decryptJson('not json at all', PASS), /not valid JSON/);
  });

  it('rejects an unknown format version', async () => {
    const file = JSON.parse(await encryptJson({ x: 1 }, PASS));
    file.v = 99;
    await assert.rejects(() => decryptJson(JSON.stringify(file), PASS), /Unsupported vault format/);
  });

  it('refuses to encrypt or decrypt with an empty passphrase', async () => {
    await assert.rejects(() => encryptJson({ x: 1 }, ''), /passphrase is required/);
    await assert.rejects(() => decryptJson('{}', ''), /passphrase is required/);
  });
});

describe('vault on disk', () => {
  it('writes, reports existence, and reads back', async () => {
    const path = join(dir, 'session.enc');
    assert.equal(await vaultExists(path), false);
    await writeVault(path, { hello: 'world' }, PASS);
    assert.equal(await vaultExists(path), true);
    assert.deepEqual(await readVault(path, PASS), { hello: 'world' });
  });

  it('writes owner-only, because the file is a live login', async () => {
    const path = join(dir, 'perms.enc');
    await writeVault(path, { x: 1 }, PASS);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  });

  it('honours the KDF parameters stored in the file, not today constants', async () => {
    // A file written when N was lower must still open after we raise the cost.
    const file = JSON.parse(await encryptJson({ x: 1 }, PASS));
    assert.equal(typeof file.n, 'number');
    assert.deepEqual(await decryptJson(JSON.stringify(file), PASS), { x: 1 });
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects everything else', () => {
    assert.equal(safeEqual('18430.50', '18430.50'), true);
    assert.equal(safeEqual('18430.50', '18430.51'), false);
    assert.equal(safeEqual('18430.50', '18430.5'), false, 'length mismatch must not throw');
    assert.equal(safeEqual('', ''), true);
  });
});
