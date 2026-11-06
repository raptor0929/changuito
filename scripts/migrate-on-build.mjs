/**
 * The migration step of the Workers build.
 *
 * Runs `db.mjs migrate` when DIRECT_URL is in the environment, which on
 * Workers Builds is the build secret of that name. The migration is
 * idempotent: db.mjs records every file it applies in `schema_migrations`, in
 * the same transaction as the file, so a rebuild applies nothing it already
 * has.
 *
 * Two other cases, and they are deliberately different:
 *
 * - On Workers Builds (WORKERS_CI=1) without DIRECT_URL, the build fails. A
 *   deploy of code that expects tables the database does not have is the
 *   worst kind of green build: it passes here and 503s in production.
 * - Anywhere else without it, nothing happens. A local `build:vinext` is a
 *   build, not a deploy, and must never reach a database because a developer
 *   happened to have one configured in apps/web/.env.local.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hasUrl = Boolean((process.env.DIRECT_URL ?? '').trim());
const onBuilds = process.env.WORKERS_CI === '1';

if (!hasUrl) {
  if (onBuilds) {
    console.error('[migrate] DIRECT_URL is not set as a build secret: refusing to deploy against an unmigrated database.');
    process.exit(1);
  }
  console.log('[migrate] skipped: DIRECT_URL is not in the environment (local build).');
  process.exit(0);
}

const run = spawnSync(process.execPath, [join(here, 'db.mjs'), 'migrate'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
