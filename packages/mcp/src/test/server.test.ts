import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

import { createSupermercadoServer } from '../server.js';

const run = promisify(execFile);

/** The registry is private, but it is the only honest answer to "which tools?". */
const toolNames = (server: unknown): string[] =>
  Object.keys((server as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {});

const CATALOG = [
  'list_retailers',
  'set_location',
  'search_products',
  'get_product',
  'price_check',
  'add_to_cart',
  'update_cart_item',
  'view_cart',
  'get_cart_link',
  'where_am_i',
];

describe('createSupermercadoServer', () => {
  it('registers every catalog tool and nothing else when checkout is off', async () => {
    const names = toolNames(await createSupermercadoServer({ checkout: false }));
    assert.deepEqual(names.sort(), [...CATALOG].sort());
  });

  it('adds the checkout tools when asked', async () => {
    const names = toolNames(await createSupermercadoServer({ checkout: true }));
    for (const t of CATALOG) assert.ok(names.includes(t), `dropped ${t}`);
    assert.ok(names.includes('approve_payment'), 'checkout tools were not registered');
    assert.ok(names.length > CATALOG.length);
  });

  it('defaults to a full server, so the stdio binary needs no arguments', async () => {
    assert.ok(toolNames(await createSupermercadoServer()).includes('approve_payment'));
  });

  it('lets a host rename itself without inventing a version', async () => {
    const s = await createSupermercadoServer({ checkout: false, name: 'changuito-web' });
    assert.equal(toolNames(s).length, CATALOG.length);
  });
});

/**
 * The reason `checkout` is a dynamic import rather than a boolean the handlers
 * check. A serverless bundle that merely *never calls* Playwright still ships
 * it; one that never resolves it does not. Nothing about the tool list can
 * prove that, so this asks Node directly.
 */
describe('RULE: a read-only server never reaches Playwright or an EVM signer', () => {
  it('resolves no forbidden module when checkout is off', async () => {
    const dist = fileURLToPath(new URL('../server.js', import.meta.url));
    const spy =
      'data:text/javascript,export async function resolve(s,c,n){' +
      'process._rawDebug("R "+s);return n(s,c)}';

    const { stderr } = await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { register } from 'node:module';` +
          `register(${JSON.stringify(spy)});` +
          `const m = await import(${JSON.stringify(dist)});` +
          `await m.createSupermercadoServer({ checkout: false });`,
      ],
      { encoding: 'utf8' },
    );

    const resolved = stderr
      .split('\n')
      .filter((l) => l.startsWith('R '))
      .map((l) => l.slice(2));

    assert.ok(resolved.length > 50, 'the resolve hook did not run — this test proves nothing');

    const forbidden = resolved.filter((s) =>
      /^(playwright|playwright-core|ethers)$/.test(s) || /\/(checkout|wallet)\//.test(s),
    );
    assert.deepEqual(forbidden, [], `read-only server pulled in: ${forbidden.join(', ')}`);
  });

  it('server.ts imports the checkout half dynamically, never at the top', async () => {
    const src = await readFile(new URL('../../src/server.ts', import.meta.url), 'utf8');
    assert.ok(!/^import .*['"]\.\/tools\.js['"]/m.test(src), 'tools.js is statically imported');
    assert.match(src, /await import\(['"]\.\/tools\.js['"]\)/);
  });
});
