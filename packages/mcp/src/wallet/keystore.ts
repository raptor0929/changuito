import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { HDNodeWallet, Wallet, getAddress, isHexString } from 'ethers';

import { setupRef } from '../onboarding.js';
import { forgetSecret, registerSecret } from '../secure/redact.js';

/**
 * The EOA signing key lives in a Web3 Secret Storage keystore (the standard
 * `--keystore` JSON that geth, ethers and every other wallet understands),
 * encrypted with scrypt under a passphrase.
 *
 * Deliberately NOT a raw key in `.env`. A `.env` private key is readable by
 * anything that can read the file or the process environment: a stray
 * `console.log(process.env)`, a crash reporter, a shell history, a backup. The
 * keystore means the on-disk artefact is useless without the passphrase, and
 * the plaintext key exists only inside `withSigner`, for the duration of one
 * signed transfer.
 *
 * ethers' own encrypt/decrypt is used rather than our vault.ts so the file
 * stays portable — you can open it in MetaMask or geth if you ever need to.
 */

export interface KeystoreConfig {
  /** Path to the encrypted keystore JSON. */
  path: string;
  /** Passphrase. Read from KEYSTORE_PASSPHRASE or prompted; never stored. */
  passphrase: string;
}

/**
 * Create a keystore from an existing private key. A one-time setup step, run
 * from the CLI — the key is passed in, encrypted, written, and dropped.
 */
export async function createKeystore(
  privateKey: string,
  passphrase: string,
  path: string,
): Promise<{ address: string; path: string }> {
  if (!passphrase || passphrase.length < 12) {
    throw new Error('Keystore passphrase must be at least 12 characters.');
  }
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  if (!isHexString(key, 32)) {
    throw new Error('Private key must be 32 bytes of hex (64 characters, optional 0x prefix).');
  }
  registerSecret(key, 'privkey');
  registerSecret(key.slice(2), 'privkey');

  try {
    const wallet = new Wallet(key);
    const json = await wallet.encrypt(passphrase);
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, json, { mode: 0o600 });
    return { address: wallet.address, path };
  } finally {
    forgetSecret(key);
    forgetSecret(key.slice(2));
  }
}

/** Generate a fresh EOA and store it. Returns the address; the key never leaves this call. */
export async function createRandomKeystore(
  passphrase: string,
  path: string,
): Promise<{ address: string; path: string }> {
  const wallet = Wallet.createRandom();
  return createKeystore(wallet.privateKey, passphrase, path);
}

/**
 * The address, without decrypting. A keystore JSON carries its address in the
 * clear, so balance checks and deposit previews need no passphrase at all —
 * which is the point: the read path never asks for the secret.
 *
 * The stored address is lowercase and un-prefixed (that is what the Web3 Secret
 * Storage spec says to write), so it is put through getAddress to come back
 * EIP-55 checksummed. Users compare this against a block explorer, and an
 * explorer shows the checksummed form — returning lowercase invites a
 * "these don't match" false alarm on the one screen where a mismatched address
 * would matter most.
 */
export async function readAddress(path: string): Promise<string> {
  const raw = JSON.parse(await fs.readFile(path, 'utf8')) as { address?: string };
  if (!raw.address) throw new Error(`${path} is not a keystore file (no address field).`);
  return getAddress(raw.address.startsWith('0x') ? raw.address : `0x${raw.address}`);
}

/**
 * Decrypt, hand the signer to `fn`, and scrub it afterwards.
 *
 * Scoped deliberately: there is no `getSigner()` that returns a live wallet,
 * because a returned signer outlives the operation it was needed for and ends
 * up captured in a closure somewhere. This shape makes the key's lifetime
 * exactly one caller's worth.
 */
export async function withSigner<T>(
  cfg: KeystoreConfig,
  fn: (wallet: Wallet | HDNodeWallet) => Promise<T>,
): Promise<T> {
  let json: string;
  try {
    json = await fs.readFile(cfg.path, 'utf8');
  } catch {
    throw new Error(
      `No keystore at ${cfg.path}. Create one with \`npm run keystore -- --new\`. ${setupRef('Crypto wallet')}`,
    );
  }

  let wallet: Wallet | HDNodeWallet;
  try {
    wallet = await Wallet.fromEncryptedJson(json, cfg.passphrase);
  } catch {
    throw new Error('Could not unlock the keystore: wrong passphrase, or the file is corrupt.');
  }

  // Belt and braces: if the key does somehow reach a log line, it is masked.
  registerSecret(wallet.privateKey, 'privkey');
  registerSecret(wallet.privateKey.slice(2), 'privkey');
  try {
    return await fn(wallet);
  } finally {
    forgetSecret(wallet.privateKey);
    forgetSecret(wallet.privateKey.slice(2));
  }
}
