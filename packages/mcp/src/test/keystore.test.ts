import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { redactToString, forgetAllSecrets } from '../secure/redact.js';
import { createKeystore, readAddress, withSigner } from '../wallet/keystore.js';

/**
 * Hardhat's account #0. This key is printed in Hardhat's README and is in every
 * public test fixture on earth — it is deliberately NOT a real key, and it must
 * never hold real funds.
 */
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PASS = 'a sufficiently long passphrase';

const dir = join(tmpdir(), `keystore-test-${process.pid}`);
const path = join(dir, 'wallet.keystore.json');

// One keystore for the whole suite: ethers uses scrypt N=2^18, so each
// encrypt/decrypt is ~1s. Creating one per test would make the suite crawl.
before(async () => {
  await createKeystore(TEST_KEY, PASS, path);
});
after(async () => {
  forgetAllSecrets();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createKeystore', () => {
  it('derives the right address and writes owner-only', async () => {
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
    assert.equal(await readAddress(path), TEST_ADDR);
  });

  it('never writes the plaintext key to disk', async () => {
    const raw = await fs.readFile(path, 'utf8');
    assert.ok(!raw.includes(TEST_KEY));
    assert.ok(!raw.includes(TEST_KEY.slice(2)));
  });

  it('is a standard Web3 Secret Storage file, so other wallets can open it', async () => {
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    // The spec allows either spelling of the section; ethers writes "Crypto",
    // geth writes "crypto". Accept both so this does not break on an upgrade.
    const crypto = raw.Crypto ?? raw.crypto;
    assert.equal(raw.version, 3);
    assert.equal(crypto.kdf, 'scrypt');
    assert.equal(crypto.cipher, 'aes-128-ctr');
  });

  it('returns a checksummed address, matching what a block explorer shows', async () => {
    const addr = await readAddress(path);
    assert.equal(addr, TEST_ADDR);
    assert.notEqual(addr, TEST_ADDR.toLowerCase(), 'must not be flat lowercase');
  });

  it('rejects a passphrase that is too short to be worth encrypting under', async () => {
    await assert.rejects(
      () => createKeystore(TEST_KEY, 'short', join(dir, 'nope.json')),
      /at least 12 characters/,
    );
  });

  it('rejects anything that is not a 32-byte hex key', async () => {
    for (const bad of ['not-hex', '0x1234', TEST_KEY + 'ff']) {
      await assert.rejects(
        () => createKeystore(bad, PASS, join(dir, 'nope.json')),
        /32 bytes of hex/,
        bad,
      );
    }
  });

  it('accepts a key with no 0x prefix', async () => {
    const p = join(dir, 'noprefix.json');
    const { address } = await createKeystore(TEST_KEY.slice(2), PASS, p);
    assert.equal(address, TEST_ADDR);
  });
});

describe('readAddress', () => {
  it('needs no passphrase — the read path never asks for the secret', async () => {
    assert.equal(await readAddress(path), TEST_ADDR);
  });

  it('rejects a file that is not a keystore', async () => {
    const p = join(dir, 'bogus.json');
    await fs.writeFile(p, JSON.stringify({ hello: 'world' }));
    await assert.rejects(() => readAddress(p), /not a keystore file/);
  });
});

describe('withSigner', () => {
  it('unlocks and yields a signer for the right address', async () => {
    const addr = await withSigner({ path, passphrase: PASS }, async (w) => w.address);
    assert.equal(addr, TEST_ADDR);
  });

  it('fails closed on the wrong passphrase', async () => {
    await assert.rejects(
      () => withSigner({ path, passphrase: 'definitely not it' }, async () => 1),
      /wrong passphrase, or the file is corrupt/,
    );
  });

  it('gives a pointed message when there is no keystore at all', async () => {
    await assert.rejects(
      () => withSigner({ path: join(dir, 'absent.json'), passphrase: PASS }, async () => 1),
      /No keystore at .*SETUP\.md/s,
    );
  });

  it('registers the key with the redactor while unlocked', async () => {
    await withSigner({ path, passphrase: PASS }, async (w) => {
      const out = redactToString(`leaking ${w.privateKey} here`);
      assert.ok(!out.includes(w.privateKey.slice(2)), out);
    });
  });

  it('forgets the key once the callback returns', async () => {
    await withSigner({ path, passphrase: PASS }, async () => undefined);
    // The bare hex still matches the generic 64-hex heuristic, so assert on the
    // placeholder: an exact-match hit is labelled, a heuristic hit is not.
    assert.ok(!redactToString(TEST_KEY).includes('[REDACTED:privkey]'));
  });

  it('forgets the key even when the callback throws', async () => {
    await assert.rejects(
      () => withSigner({ path, passphrase: PASS }, async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.ok(!redactToString(TEST_KEY).includes('[REDACTED:privkey]'));
  });
});
