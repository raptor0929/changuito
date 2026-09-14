import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createSupermercadoServer } from '../server.js';
import { createSessionState } from '../session.js';

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
    const names = toolNames(createSupermercadoServer());
    assert.deepEqual(names.sort(), [...CATALOG].sort());
  });

  it('cannot be asked for the checkout tools at all', async () => {
    // Not `checkout: false` — there is no option. A host that wants them
    // imports them, which is why no bundler can find them from here.
    const names = toolNames(createSupermercadoServer());
    assert.ok(!names.includes('approve_payment'));
    assert.ok(!names.some((n) => n.includes('payment') || n.includes('link_marketplace')));
  });

  it('lets a host rename itself without inventing a version', async () => {
    const s = createSupermercadoServer({ name: 'changuito-web' });
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
  it('resolves no forbidden module', async () => {
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
          `m.createSupermercadoServer();`,
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

  it('server.ts never names the checkout module, statically or dynamically', async () => {
    // A dynamic import would be no better: bundlers resolve `await import()`
    // at build time, so the dependency would stay out of the running code and
    // end up in the deployment anyway.
    const src = await readFile(new URL('../../src/server.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    assert.ok(!/['"]\.\/tools\.js['"]/.test(code), 'server.ts references tools.js');
  });

  it('the stdio binary is where the checkout tools come from', async () => {
    const src = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
    assert.match(src, /import \{ registerCheckoutTools \} from '\.\/tools\.js'/);
    assert.match(src, /registerCheckoutTools\(server\)/);
  });
});

/** A real client, so these assertions are about the protocol and not the object. */
async function connected() {
  const state = createSessionState();
  const server = createSupermercadoServer({ session: state });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server, state, close: async () => { await client.close(); await server.close(); } };
}

describe('over a real MCP transport', () => {
  it('hands the client instructions to put in its system prompt', async () => {
    const c = await connected();
    const text = c.client.getInstructions() ?? '';
    assert.match(text, /set_location/, 'instructions do not state the flow');
    assert.match(text, /DOES NOT BUY/, 'instructions do not say where the server stops');
    await c.close();
  });

  it('RULE: names no tool it did not register', async () => {
    // The bug this exists for: the instructions once described the full
    // checkout flow, so a host that registered only the catalog tools was
    // telling the model to call six tools that were not there. Instructions
    // are a promise, and this is the only thing that checks it is kept.
    const c = await connected();
    const registered = new Set((await c.client.listTools()).tools.map((t) => t.name));
    const named = (c.client.getInstructions() ?? '').match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
    const missing = [...new Set(named)].filter((n) => !registered.has(n));
    assert.deepEqual(missing, [], `instructions promise tools that do not exist: ${missing.join(', ')}`);
    assert.ok(named.length >= 4, 'instructions name almost no tools — is the regex still right?');
    await c.close();
  });

  it('declares an output shape for exactly the tools a UI draws', async () => {
    const c = await connected();
    const { tools } = await c.client.listTools();
    const structured = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
    // Anything else is read by the model, not rendered, and a schema it does
    // not need is a schema that can drift.
    assert.deepEqual(structured, ['get_cart_link', 'search_products', 'view_cart']);
    await c.close();
  });

  it('describes products with the fields a card needs', async () => {
    const c = await connected();
    const { tools } = await c.client.listTools();
    const schema = tools.find((t) => t.name === 'search_products')!.outputSchema as any;
    const product = schema.properties.products.items.properties;
    for (const f of ['skuId', 'name', 'sellerId', 'price', 'available', 'imageUrl']) {
      assert.ok(product[f], `a product card cannot be drawn without ${f}`);
    }
    assert.deepEqual(Object.keys(product.price.properties).sort(), ['centavos', 'display']);
    await c.close();
  });

  it('reports a tool failure as isError rather than throwing at the client', async () => {
    const c = await connected();
    const res = await c.client.callTool({ name: 'search_products', arguments: { query: 'leche' } });
    assert.equal(res.isError, true, 'searching with no location should be a tool error');
    assert.match((res.content as any)[0].text, /set_location/);
    await c.close();
  });

  it('still answers a no-argument tool with plain text', async () => {
    const c = await connected();
    const res = await c.client.callTool({ name: 'list_retailers', arguments: {} });
    assert.equal(res.isError, undefined);
    assert.match((res.content as any)[0].text, /dia\s+D/);
    await c.close();
  });
});
