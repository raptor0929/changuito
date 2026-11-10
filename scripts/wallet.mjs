/**
 * Manage a wallet row without hand-written SQL.
 *
 *   node scripts/wallet.mjs list
 *   node scripts/wallet.mjs allow  G...
 *   node scripts/wallet.mjs unallow G...
 *   node scripts/wallet.mjs ban    G...
 *   node scripts/wallet.mjs unban  G...
 *
 * An address that has not signed in yet is inserted, so a grant or a ban
 * is already there when the first login arrives and is not overwritten.
 * Network defaults to testnet. Pass mainnet as the last argument to use it.
 *
 * Connects like scripts/config.mjs and never prints the database URL.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

const ADDRESS = /^G[A-Z2-7]{55}$/;

function where(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}`;
  } catch {
    return 'an unparseable database URL';
  }
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DIRECT_URL or DATABASE_URL for apps/web.');
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const args = process.argv.slice(2);
const network = args.find((part) => part === 'testnet' || part === 'mainnet') ?? 'testnet';
const address = args.find((part) => ADDRESS.test(part));
const cmd = args.find((part) => ['list', 'allow', 'unallow', 'ban', 'unban'].includes(part));

function line(row) {
  const flags = [row.faucet_allowed ? 'faucet' : 'no-faucet', row.banned ? 'banned' : 'active'].join(' ');
  console.log(`${row.network} ${row.address}  ${flags}  ${row.updated_at.toISOString()}`);
}

try {
  if (cmd === 'list' && !address) {
    const rows = await sql`select network, address, faucet_allowed, banned, updated_at from wallet order by created_at`;
    if (!rows.length) console.log('(no wallets)');
    for (const row of rows) line(row);
  } else if (cmd && address) {
    const faucet = cmd === 'allow' ? true : cmd === 'unallow' ? false : null;
    const banned = cmd === 'ban' ? true : cmd === 'unban' ? false : null;
    const rows = await sql`
      insert into wallet (network, address, faucet_allowed, banned)
      values (
        ${network},
        ${address},
        ${faucet ?? false},
        ${banned ?? false}
      )
      on conflict (network, address) do update set
        faucet_allowed = coalesce(${faucet}, wallet.faucet_allowed),
        banned = coalesce(${banned}, wallet.banned)
      returning network, address, faucet_allowed, banned, updated_at`;
    console.log(`updated on ${where(url)}`);
    line(rows[0]);
  } else {
    console.error('usage: node scripts/wallet.mjs <list | allow | unallow | ban | unban> [G...] [testnet|mainnet]');
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`wallet failed on ${where(url)}: ${err.code ?? ''} ${err.message}`);
  if (err.code === '42P01') console.error('The wallet table does not exist: run npm run db:migrate first.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
