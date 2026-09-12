import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Encrypted-at-rest JSON, for things that are not private keys but would still
 * be bad to leave in the clear — principally the Playwright `storageState`,
 * which is a live authenticated session for the user's supermarket account.
 * Anyone who reads that file is logged in as them.
 *
 * Private keys do NOT use this: they use the standard Web3 Secret Storage
 * keystore in wallet/keystore.ts, so they stay portable to other wallet tools.
 *
 * Format: scrypt(passphrase, salt) -> 32-byte key -> AES-256-GCM.
 * The auth tag is what makes this tamper-evident; decryption of a modified file
 * fails rather than returning garbage.
 */

const VERSION = 1;
/** 128 * N * r = 67 MB of memory per attempt. Node's default maxmem is 32 MB, so it is raised explicitly below. */
const N = 1 << 16;
const R = 8;
const P = 1;
const MAXMEM = 256 * 1024 * 1024;
const KEY_LEN = 32;

interface VaultFile {
  v: number;
  kdf: 'scrypt';
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

const derive = (passphrase: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(passphrase, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    );
  });

export async function encryptJson(data: unknown, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('A passphrase is required to encrypt.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(data), 'utf8')),
    cipher.final(),
  ]);

  key.fill(0);

  const file: VaultFile = {
    v: VERSION,
    kdf: 'scrypt',
    n: N,
    r: R,
    p: P,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
  return JSON.stringify(file);
}

export async function decryptJson<T>(serialized: string, passphrase: string): Promise<T> {
  if (!passphrase) throw new Error('A passphrase is required to decrypt.');

  let file: VaultFile;
  try {
    file = JSON.parse(serialized) as VaultFile;
  } catch {
    throw new Error('Vault file is not valid JSON — it is corrupt or was never a vault file.');
  }
  if (file.v !== VERSION || file.kdf !== 'scrypt') {
    throw new Error(`Unsupported vault format (v${file.v}, kdf ${file.kdf}).`);
  }

  // Honour the parameters stored in the file rather than today's constants, so
  // a file written by an older version still opens after we raise the cost.
  const salt = Buffer.from(file.salt, 'base64');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      KEY_LEN,
      { N: file.n, r: file.r, p: file.p, maxmem: MAXMEM },
      (err, k) => (err ? reject(err) : resolve(k as Buffer)),
    );
  });

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(file.ct, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(pt.toString('utf8')) as T;
  } catch {
    // GCM cannot distinguish "wrong passphrase" from "tampered file"; both fail
    // the tag check. Say so rather than implying the passphrase is definitely wrong.
    throw new Error(
      'Could not decrypt: wrong passphrase, or the file has been modified since it was written.',
    );
  } finally {
    key.fill(0);
  }
}

/** Write a vault file with owner-only permissions. */
export async function writeVault(path: string, data: unknown, passphrase: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, await encryptJson(data, passphrase), { mode: 0o600 });
}

export async function readVault<T>(path: string, passphrase: string): Promise<T> {
  return decryptJson<T>(await fs.readFile(path, 'utf8'), passphrase);
}

export async function vaultExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Constant-time string compare, for confirming a restated amount or a passphrase echo. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
