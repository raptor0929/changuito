/**
 * One-time setup for the EOA that tops up the Vyrion wallet.
 *
 *   node dist/keystore-cli.js --new       # generate a fresh wallet
 *   node dist/keystore-cli.js --import    # encrypt a key you already have
 *   node dist/keystore-cli.js --show      # print the address (no passphrase needed)
 *
 * A private key is never accepted as a command-line argument. Arguments are
 * visible in `ps`, in shell history and in any process listing — so `--import`
 * reads the key from stdin with echo off and forgets it as soon as it is
 * encrypted.
 */

import { loadConfig, passphraseFromEnv } from './config.js';
import { createKeystore, createRandomKeystore, readAddress } from './wallet/keystore.js';

const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(`--${f}`);

const cfg = loadConfig();

if (has('show') || argv.length === 0) {
  try {
    console.log(await readAddress(cfg.keystorePath));
    console.log(`(from ${cfg.keystorePath})`);
  } catch (e) {
    console.error(`${(e as Error).message}\nRun with --new to create one.`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Read one line from stdin, echoing nothing.
 *
 * Written against the raw stream rather than `readline`, because readline
 * echoes what it reads and every documented way to mute it reaches into a
 * private method. A function whose whole job is "this value must not appear
 * anywhere" should not depend on an underscore-prefixed API — so this reads
 * bytes and writes none. It behaves identically for a typed line and a piped
 * one, which is what makes the tool scriptable as well as safe.
 */
let leftover = '';

function secret(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  // A pipe delivers every line in one chunk, so what the previous call did not
  // consume is the next call's input. Without this, two prompts fed from a
  // pipe would hang on the second one.
  const fromLeftover = takeLine();
  if (fromLeftover !== undefined) {
    process.stdout.write('\n');
    return Promise.resolve(fromLeftover);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const isTty = Boolean(stdin.isTTY);

    const done = (value?: string, err?: Error): void => {
      stdin.removeListener('data', onData);
      if (isTty) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err);
      else resolve(value!);
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        // Ctrl-C has to be handled by hand in raw mode, or it is just a byte.
        if (ch === '\u0003') return done(undefined, new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') leftover = leftover.slice(0, -1);
        else leftover += ch;
      }
      const line = takeLine();
      if (line !== undefined) done(line);
    };

    if (isTty) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** Pull one complete line out of the buffer, or undefined if there isn't one. */
function takeLine(): string | undefined {
  const i = leftover.search(/[\r\n\u0004]/);
  if (i < 0) return undefined;
  const line = leftover.slice(0, i);
  leftover = leftover.slice(i + 1).replace(/^\n/, ''); // swallow \r\n
  return line.trim();
}

async function passphrase(): Promise<string> {
  const fromEnv = passphraseFromEnv('WALLET_PASSPHRASE');
  if (fromEnv) {
    console.log('Using WALLET_PASSPHRASE from the environment.');
    return fromEnv;
  }
  const first = await secret('Passphrase (12+ characters): ');
  const again = await secret('Again: ');
  if (first !== again) {
    console.error('Those did not match. Nothing was written.');
    process.exit(1);
  }
  if (first.length < 12) {
    console.error('Passphrase must be at least 12 characters. Nothing was written.');
    process.exit(1);
  }
  return first;
}

if (has('new')) {
  const r = await createRandomKeystore(await passphrase(), cfg.keystorePath);
  console.log(`
Created ${r.path}

  Address: ${r.address}

  This wallet is empty. Send it the funding asset (${cfg.wallet.asset.toUpperCase()}) on
  chain ${cfg.wallet.chainId}, plus a little native currency for gas, then use
  replenish_wallet to move funds to Vyrion.

  Back up the keystore file AND remember the passphrase. Neither is recoverable
  from the other, and nothing here keeps a copy of either.
`);
  process.exit(0);
}

if (has('import')) {
  const key = await secret('Private key (hex, will not be echoed): ');
  const r = await createKeystore(key, await passphrase(), cfg.keystorePath);
  console.log(`\nEncrypted ${r.address} into ${r.path}.`);
  console.log('The plaintext key was not written anywhere and is gone from memory.');
  process.exit(0);
}

console.error('Nothing to do. Use --new, --import or --show.');
process.exit(1);
