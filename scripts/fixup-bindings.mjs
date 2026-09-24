/**
 * Makes a `stellar contract bindings typescript` package fit this monorepo.
 *
 * The CLI emits a standalone npm package: unscoped name, its own pinned copy of
 * @stellar/stellar-sdk, and `exports` pointing at a `dist/` that only exists
 * after a separate `tsc` run. Three problems here:
 *
 *   1. A second copy of the SDK means two sets of XDR classes in one process,
 *      and `instanceof` stops working across the seam. The bindings must use
 *      the exact version apps/web resolves.
 *   2. A dist build is a build step Vercel would have to be told about. Next
 *      already compiles workspace sources via transpilePackages, so pointing
 *      `exports` at src/ removes the step entirely.
 *   3. The generated README tells you to run that build, which is now wrong.
 *
 * Run by scripts/deploy.sh right after generation, so a regenerated
 * binding is never left in the standalone shape.
 *
 * Generated from testnet only. The app uses these as pure ABI — argument
 * encoding and error codes, identical on every network — and takes contract
 * ids from apps/web/lib/deployments.ts, so one bundle can talk to two chains.
 * The `networks` export the CLI bakes in is deliberately never imported.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [dir, name] = process.argv.slice(2);
if (!dir || !name) {
  console.error('usage: fixup-bindings.mjs <dir> <package-name>');
  process.exit(1);
}

const root = new URL('..', import.meta.url).pathname;
const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
const sdk = web.dependencies['@stellar/stellar-sdk'];
if (!sdk) throw new Error('apps/web does not depend on @stellar/stellar-sdk — which version should the bindings use?');

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      // Source, not dist. See the note at the top of this file.
      exports: './src/index.ts',
      dependencies: { '@stellar/stellar-sdk': sdk, buffer: pkg.dependencies.buffer },
    },
    null,
    2,
  ) + '\n',
);

// tsc never runs here, so its config is a 300-line answer to a question nobody
// asks. Same for the .gitignore, which only ignored the dist we no longer make.
for (const f of ['tsconfig.json', '.gitignore']) rmSync(join(dir, f), { force: true });

const id = readFileSync(join(dir, 'src/index.ts'), 'utf8').match(/contractId: "(C[A-Z0-9]+)"/)?.[1];
writeFileSync(
  join(dir, 'README.md'),
  `# ${name}

Generated from the deployed contract \`${id}\` by \`stellar contract bindings typescript\`,
then reshaped by \`scripts/fixup-bindings.mjs\`. **Do not edit by hand** — the next
deploy overwrites everything here.

To regenerate after a contract change:

    ./scripts/deploy.sh --force

The contract id is baked into \`networks.testnet\` in \`src/index.ts\`, and the same
id is recorded in \`deployments.json\` at the repo root. They are written by the
same script, so if they ever disagree, something ran halfway.
`,
);

console.log(`  fixed up ${name} -> exports src, sdk ${sdk}`);
