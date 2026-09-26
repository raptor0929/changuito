/**
 * The only way this repo talks to Postgres from the command line.
 *
 * It loads apps/web/.env the way Next does, so DATABASE_URL and DIRECT_URL
 * travel from the file to the driver without passing through a shell history,
 * a log line or a transcript. Nothing here ever prints a connection string: a
 * failure reports the SQLSTATE and the host, which is enough to fix it and not
 * enough to reuse it.
 *
 *   node scripts/db.mjs migrate     apply supabase/migrations/*.sql, in order
 *   node scripts/db.mjs status      what is applied, and what is pending
 *   node scripts/db.mjs psql <sql>  one statement, for inspection
 *
 * Migrations run over DIRECT_URL (5432). The pooler on 6543 is transaction
 * mode, which does not keep a session across statements — DDL and advisory
 * locks both need one, so using it here would fail in ways that look random.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @next/env is CommonJS: it has no named ESM exports, so it comes in whole.
import nextEnv from '@next/env';
import postgres from 'postgres';

const { loadEnvConfig } = nextEnv;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// Quiet: @next/env logs which env files it read, and that is noise here.
loadEnvConfig(join(ROOT, 'apps', 'web'), true, { info: () => {}, error: () => {} });

/** Never the URL itself — only enough of it to tell one database from another. */
function where(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}`;
  } catch {
    return 'an unparseable DIRECT_URL';
  }
}

function connect() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DIRECT_URL in apps/web/.env (the 5432 endpoint, not 6543).');
    process.exit(1);
  }
  // prepare:false because Supabase's pooler rejects named prepared statements
  // even in session mode; onnotice off because `create table if not exists`
  // is chatty and the notices are not news.
  return { sql: postgres(url, { max: 1, prepare: false, onnotice: () => {} }), at: where(url) };
}

const files = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

async function ensureLedger(sql) {
  await sql`
    create table if not exists schema_migrations (
      name       text        primary key,
      applied_at timestamptz not null default now()
    )`;
}

async function migrate(sql) {
  await ensureLedger(sql);
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const pending = files().filter((f) => !done.has(f));
  if (!pending.length) {
    console.log('Nothing to apply.');
    return;
  }
  for (const name of pending) {
    const body = readFileSync(join(MIGRATIONS, name), 'utf8');
    // One transaction per file: a half-applied migration is the worst outcome,
    // and recording it in the same transaction is what makes a re-run safe.
    await sql.begin(async (tx) => {
      // .simple() because a migration file holds many statements and the
      // extended protocol accepts exactly one per round trip.
      await tx.unsafe(body).simple();
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    console.log(`applied  ${name}`);
  }
}

async function status(sql) {
  await ensureLedger(sql);
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  for (const f of files()) console.log(`${done.has(f) ? 'applied ' : 'PENDING '} ${f}`);
  const tables = await sql`
    select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`;
  console.log('\ntables:', tables.map((t) => t.table_name).join(', ') || '(none)');
}

const [cmd, ...rest] = process.argv.slice(2);
const { sql, at } = connect();
try {
  if (cmd === 'migrate') await migrate(sql);
  else if (cmd === 'status') await status(sql);
  else if (cmd === 'psql') console.table(await sql.unsafe(rest.join(' ')));
  else {
    console.error('usage: node scripts/db.mjs migrate|status|psql <sql>');
    process.exitCode = 1;
  }
} catch (err) {
  // SQLSTATE and host, never the URL.
  console.error(`db error at ${at}: ${err.code ?? 'ERR'} ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
