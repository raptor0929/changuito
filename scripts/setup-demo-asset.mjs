/**
 * Issue the testnet USDC that preview mode actually pays with. Run once.
 *
 * Preview is a demo with a ledger behind it: a visitor with no session fills a
 * basket and a real Stellar payment settles against a real card. For that to
 * rehearse the mainnet path rather than approximate it, the money it moves has
 * to be the same *kind* of money — a classic asset, reachable by a classic
 * payment, carrying a memo.
 *
 * Testnet's existing USDC is not that. `contracts/mock_usdc` is a pure SEP-41
 * Soroban token (`contracts.usdc.id`, issuer `null`): balances live in contract
 * storage, transfers are contract events, and there is no classic payment
 * record with a memo field for `matchDeposit` to read. Minting billions of it
 * to the demo wallet would fund a balance the deposit rail cannot see. That is
 * why `depositAssetFor` reads a falsy issuer as native XLM, and why preview
 * paid in lumens until this script ran.
 *
 * So: a classic asset of our own, with a supply fixed at a billion.
 *
 * ## No secret passes through this process
 *
 * Every signature is made by the `stellar` CLI from a local identity named on
 * the command line. The secrets stay in the CLI keystore — they are never read
 * here, never printed, never put in argv where `ps` would show them, and never
 * written to an env file. The demo wallet's secret reaches the deployment by a
 * separate route (`DEMO_WALLET_SECRET` in Vercel, set by hand), and the deposit
 * account's secret reaches it not at all.
 *
 * The issuer's secret is discarded outright. The last thing this script does
 * before deleting the identity is set the issuer's master weight to 0, which
 * locks the account: no further issuance is possible by anyone, including us,
 * including with the key. "A billion is the supply" is then a property of the
 * ledger rather than a promise in a comment.
 *
 *   node scripts/setup-demo-asset.mjs --demo test --deposit gf
 *
 * `--demo` and `--deposit` are `stellar keys ls` identity names. The script
 * checks that `--deposit` really is DEPOSIT_ADDRESS_TESTNET before it signs
 * anything, and refuses to run at all if testnet already has a classic issuer
 * in deployments.json.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';

const NETWORK = 'testnet';
const CODE = 'USDC';
/** Units, not stroops. The whole supply, paid to the demo wallet in one go. */
const SUPPLY = 1_000_000_000n;
const STROOPS = 10_000_000n;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]?.replace(/^--/, ''), process.argv[i + 1]);
}
const demoKey = args.get('demo');
const depositKey = args.get('deposit');
if (!demoKey || !depositKey) {
  console.error('usage: node scripts/setup-demo-asset.mjs --demo <identity> --deposit <identity>');
  console.error('       both are `stellar keys ls` names; their secrets never leave the keystore');
  process.exit(2);
}

const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'));
const net = deployments.networks[NETWORK];

// Refusing to re-run is the whole idempotency story. A second issuer would not
// overwrite the first, it would silently create a second asset with the same
// code, and every balance minted against the old one would stop being spendable
// the moment deployments.json pointed at the new one.
if (net.contracts.usdc.issuer) {
  console.error(`${NETWORK} already has a classic ${CODE} issuer: ${net.contracts.usdc.issuer}`);
  console.error('Issuing a second one would orphan every balance held against the first.');
  process.exit(1);
}

/** The CLI, with its output captured so a stray secret could not reach a log. */
function stellar(argv, { quiet = false } = {}) {
  try {
    return execFileSync('stellar', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (quiet) return null;
    // stderr only. stdout on a failed `tx new` can echo the transaction back.
    console.error(`\nstellar ${argv.slice(0, 3).join(' ')} failed:\n${err.stderr ?? err.message}`);
    process.exit(1);
  }
}

const addressOf = (identity) => {
  const out = stellar(['keys', 'address', identity], { quiet: true });
  if (!out) {
    console.error(`No local identity named "${identity}". \`stellar keys ls\` shows what there is.`);
    process.exit(1);
  }
  return out;
};

const demo = addressOf(demoKey);
const deposit = addressOf(depositKey);

// The one check worth making before any signature: that `--deposit` is the
// account the app will actually watch. Trustlining the wrong account produces
// a setup that looks complete and then drops every deposit on the floor.
const expected = (process.env.DEPOSIT_ADDRESS_TESTNET ?? '').trim().toUpperCase();
if (!expected) {
  console.error('DEPOSIT_ADDRESS_TESTNET is not set in apps/web/.env — nothing to check --deposit against.');
  process.exit(1);
}
if (deposit !== expected) {
  console.error(`--deposit ${depositKey} is ${deposit},\nbut DEPOSIT_ADDRESS_TESTNET is ${expected}.`);
  process.exit(1);
}

async function exists(address) {
  const res = await fetch(`${net.horizonUrl}/accounts/${address}`);
  return res.status !== 404;
}

async function ensureFunded(address, label) {
  if (await exists(address)) return;
  console.log(`  funding ${label} from friendbot…`);
  const res = await fetch(`${net.friendbotUrl}?addr=${address}`);
  if (!res.ok) {
    console.error(`friendbot refused ${address}: ${res.status}`);
    process.exit(1);
  }
}

console.log(`Issuing a classic ${CODE} on ${NETWORK}.`);
console.log(`  demo wallet     ${demo}`);
console.log(`  deposit account ${deposit}`);

await ensureFunded(demo, 'the demo wallet');
await ensureFunded(deposit, 'the deposit account');

// A throwaway name: the identity is removed at the end, and a timestamp keeps
// a half-finished run from colliding with the retry.
const issuerKey = `changuito-demo-issuer-${Date.now()}`;
stellar(['keys', 'generate', issuerKey, '--network', NETWORK, '--fund']);
const issuer = addressOf(issuerKey);
console.log(`  issuer          ${issuer}  (temporary identity ${issuerKey})`);

const line = `${CODE}:${issuer}`;

// Both sides of the rail opt in. The demo wallet to hold the supply, the
// deposit account to receive what preview spends — a classic asset cannot
// reach an account that has not trusted it, and the payment fails at submit.
// The limit is left at the CLI's default, which is int64 max.
for (const [identity, address, label] of [
  [demoKey, demo, 'demo wallet'],
  [depositKey, deposit, 'deposit account'],
]) {
  console.log(`  trustline on the ${label}…`);
  stellar(['tx', 'new', 'change-trust', '--source-account', identity, '--line', line, '--network', NETWORK]);
}

console.log(`  paying ${SUPPLY.toLocaleString('en-US')} ${CODE} to the demo wallet…`);
stellar([
  'tx', 'new', 'payment',
  '--source-account', issuerKey,
  '--destination', demo,
  '--asset', line,
  '--amount', String(SUPPLY * STROOPS),
  '--network', NETWORK,
]);

// Lock the issuer. After this the supply cannot change, and the secret we are
// about to delete would not be worth anything to whoever found it.
console.log('  locking the issuer so the supply is final…');
stellar(['tx', 'new', 'set-options', '--source-account', issuerKey, '--master-weight', '0', '--network', NETWORK]);
stellar(['keys', 'rm', issuerKey]);

console.log(`\nDone. The supply is fixed at ${SUPPLY.toLocaleString('en-US')} ${CODE} and the issuer is locked.`);
console.log('\nNext, point the app at it:');
console.log(`  1. deployments.json → networks.${NETWORK}.contracts.usdc.issuer = "${issuer}"`);
console.log('  2. node scripts/write-deployments-module.mjs');
console.log(`  3. node scripts/check-deposit-account.mjs ${NETWORK}`);
