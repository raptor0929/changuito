/**
 * Is the deposit account ready to be paid?
 *
 * Three ways a first real payment dies at submit, none of which the app can
 * see and all of which look fine in a dashboard:
 *
 *   1. No trustline for the asset. A classic asset cannot reach an account
 *      that has not opted into it, so the shopper's transaction fails after
 *      they pressed send.
 *   2. A trustline on the *wrong issuer*. Identical in any UI that shows only
 *      the code, and identical in its failure. This is why the check reads the
 *      issuer rather than matching on "USDC".
 *   3. Not enough XLM. Each trustline raises the reserve by 0.5, so an account
 *      funded with exactly 1 XLM cannot hold one.
 *
 * Reads DEPOSIT_ADDRESS_<NETWORK> from apps/web/.env the way Next does. The
 * address is public by nature — it is printed on screen for shoppers — so this
 * does print it; nothing else from the environment is touched.
 *
 *   node scripts/check-deposit-account.mjs mainnet
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

const network = process.argv[2] ?? 'mainnet';
if (network !== 'testnet' && network !== 'mainnet') {
  console.error('usage: node scripts/check-deposit-account.mjs testnet|mainnet');
  process.exit(2);
}

const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'));
const net = deployments.networks[network];
const code = net.contracts.usdc.symbol;
const issuer = net.contracts.usdc.issuer;

const address = process.env[`DEPOSIT_ADDRESS_${network.toUpperCase()}`];
if (!address) {
  console.error(`DEPOSIT_ADDRESS_${network.toUpperCase()} is not set in apps/web/.env.`);
  process.exit(1);
}

// The native branch is testnet's, deliberately: its USDC is a Soroban token
// with no issuer, and a contract token needs no trustline. Saying so is more
// useful than reporting a missing trustline that was never wanted.
if (!issuer) {
  console.log(`${network}: deposits are native XLM — no trustline applies.`);
  console.log(`  account  ${address}`);
  process.exit(0);
}

const res = await fetch(`${net.horizonUrl}/accounts/${address}`);
if (res.status === 404) {
  console.error(`${address} does not exist on ${network}. Fund it with XLM first.`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`Horizon answered ${res.status} for ${address}.`);
  process.exit(1);
}

const account = await res.json();
const native = account.balances.find((b) => b.asset_type === 'native');
const xlm = Number(native?.balance ?? 0);
const line = account.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
const wrongIssuer = account.balances.filter((b) => b.asset_code === code && b.asset_issuer !== issuer);

// 1 XLM base reserve + 0.5 per trustline, and fees on top of that.
const NEEDED_XLM = 1.6;
const problems = [];

console.log(`${network}: ${address}`);
console.log(`  asset      ${code}:${issuer}`);
console.log(`  XLM        ${xlm.toFixed(4)}${xlm < NEEDED_XLM ? `  (want >= ${NEEDED_XLM})` : ''}`);

if (line) {
  const limit = Number(line.limit ?? 0);
  const held = Number(line.balance ?? 0);
  console.log(`  trustline  present — balance ${held}, limit ${limit}`);
  if (limit > 0 && limit - held < 1) {
    problems.push('the trustline limit leaves room for less than 1 unit — a deposit could bounce');
  }
} else {
  problems.push(`no ${code} trustline for issuer ${issuer}`);
  console.log('  trustline  MISSING');
}

for (const b of wrongIssuer) {
  problems.push(`a ${code} trustline exists for a DIFFERENT issuer (${b.asset_issuer}) — payments to it will not be seen`);
}
if (xlm < NEEDED_XLM) {
  problems.push(`only ${xlm} XLM; needs about ${NEEDED_XLM} for the reserve and fees`);
}

if (!problems.length) {
  console.log('\nReady to be paid.');
  process.exit(0);
}
console.error('\nNot ready:');
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
