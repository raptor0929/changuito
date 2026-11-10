/**
 * Read and flip the runtime switches in the `config` table (migration 0008).
 *
 *   npm run config                          every row, and what it means now
 *   npm run config -- get sandbox_mock
 *   npm run config -- set sandbox_mock true
 *   npm run config -- set sandbox_mock_fail false
 *   npm run config -- set manual_checkout_flow guided
 *
 * Connects like scripts/db.mjs: the web app's env file loaded the way Next
 * does, DIRECT_URL or DATABASE_URL, and never prints either. The app caches
 * the table for 15 seconds (apps/web/lib/config.ts), so a flip lands within
 * that.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @next/env is CommonJS: it has no named ESM exports, so it comes in whole.
import nextEnv from '@next/env';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

/** What each known key does, so `set` can say what just changed. */
const KNOWN = {
  manual_checkout_enabled: (on) => on
    ? 'eligible card members receive an embedded manual checkout with a preparation fee'
    : 'new manual checkout admissions are disabled; existing sessions continue',
  sandbox_mock: (on) =>
    on
      ? 'new checkouts run on the in-process mock, even with SANDBOX_URL set'
      : 'new checkouts go to SANDBOX_URL, or are refunded when it is unset',
  sandbox_mock_fail: (on) =>
    on ? "the mock's card comes back declined (the refund path)" : 'the mock places the order (the settle path)',
};

/** String keys. Anything other than the listed values reads as the default. */
const STRING_KEYS = {
  manual_checkout_flow: (value) => {
    if (value === 'guided') return 'members see one checkout step at a time, then the remote browser';
    if (value === 'headless') return 'members see progress and a card form; the worker pays with no remote browser';
    return 'members see the remote browser checkout (also the reading when the value is missing or unknown)';
  },
};

/** Never the URL itself — only enough of it to tell one database from another. */
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
  console.error('Set DIRECT_URL or DATABASE_URL for apps/web. Without a database every flag reads as off.');
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const parse = (raw) => {
  if (raw === 'true' || raw === 'on' || raw === '1') return true;
  if (raw === 'false' || raw === 'off' || raw === '0') return false;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
const describe = (key, value) => {
  if (STRING_KEYS[key]) return `  → ${STRING_KEYS[key](value)}`;
  return KNOWN[key] ? `  → ${KNOWN[key](value === true || value === 'true')}` : '';
};
const known = (key) => Boolean(KNOWN[key] || STRING_KEYS[key]);

const [cmd = 'list', key, raw] = process.argv.slice(2);
try {
  if (cmd === 'list') {
    const rows = await sql`select key, value, updated_at from config order by key`;
    if (!rows.length) console.log('(no rows: every flag reads as off)');
    for (const r of rows) {
      console.log(`${r.key} = ${JSON.stringify(r.value)}   (${r.updated_at.toISOString()})${describe(r.key, r.value)}`);
    }
  } else if (cmd === 'get' && key) {
    const [r] = await sql`select value from config where key = ${key}`;
    const missing = key === 'manual_checkout_flow' ? 'reads as viewer' : 'reads as off';
    console.log(r ? `${key} = ${JSON.stringify(r.value)}${describe(key, r.value)}` : `${key} is not set (${missing})`);
  } else if (cmd === 'set' && key && raw !== undefined) {
    if (!known(key)) console.warn(`note: ${key} is not a key the app reads (known: ${[...Object.keys(KNOWN), ...Object.keys(STRING_KEYS)].join(', ')})`);
    const value = parse(raw);
    if (key === 'manual_checkout_flow' && !['viewer', 'guided', 'headless'].includes(value)) {
      console.error('manual_checkout_flow must be viewer, guided or headless');
      process.exitCode = 2;
      return;
    }
    await sql`insert into config (key, value) values (${key}, ${sql.json(value)})
              on conflict (key) do update set value = excluded.value`;
    console.log(`${key} = ${JSON.stringify(value)} on ${where(url)}${describe(key, value)}`);
  } else {
    console.error('usage: npm run config [-- list | get <key> | set <key> <value>]');
    process.exitCode = 2;
  }
} catch (err) {
  // SQLSTATE and message only; 42P01 means migration 0008 is not applied yet.
  console.error(`config failed on ${where(url)}: ${err.code ?? ''} ${err.message}`);
  if (err.code === '42P01') console.error('The config table does not exist: run npm run db:migrate first.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
