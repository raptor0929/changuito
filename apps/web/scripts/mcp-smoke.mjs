/**
 * Proves the web app's MCP wiring without starting Next or calling Anthropic.
 *
 *   npm run mcp:smoke -w @changuito/web
 *
 * Everything here is offline except the last check, which is the point: if
 * this passes and the chat is still broken, the problem is the agent loop, not
 * the transport.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSupermercadoServer } from '@changuito/mcp/server';
import { createSessionState } from '@changuito/mcp/session';

const ok = (label, value) => console.log(`  ok  ${label}${value ? ` — ${value}` : ''}`);
const die = (label, detail) => {
  console.error(`  FAIL  ${label}\n        ${detail}`);
  process.exitCode = 1;
};

const state = createSessionState();
const server = await createSupermercadoServer({ checkout: false, session: state });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'changuito-web', version: '0.1.0' }, { capabilities: {} });
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
ok('initialize handshake');

const { tools } = await client.listTools();
tools.length === 10
  ? ok('tools/list', `${tools.length} read-only tools`)
  : die('tools/list', `expected 10 read-only tools, got ${tools.length}: ${tools.map((t) => t.name)}`);

tools.some((t) => t.name === 'approve_payment')
  ? die('checkout tools absent', 'approve_payment leaked into a read-only server')
  : ok('checkout tools absent');

const instructions = client.getInstructions();
instructions?.includes('diagnose')
  ? ok('server instructions received', `${instructions.length} chars`)
  : die('server instructions', 'the client got no instructions to put in the system prompt');

const retailers = await client.callTool({ name: 'list_retailers', arguments: {} });
ok('tools/call list_retailers', retailers.content[0].text.split('\n')[1].trim());

const early = await client.callTool({ name: 'search_products', arguments: { query: 'leche' } });
early.isError
  ? ok('search before set_location is an error, not a crash')
  : die('search before set_location', 'expected isError, got a result');

// A snapshot has to survive the process that made it — see lib/mcp/session.ts.
state.setLocation({
  retailer: 'dia', country: 'ARG', postalCode: '1425',
  sellers: [], salesChannel: '1', degraded: false,
});
state.rememberCart('dia', 'cart-abc');

const revived = createSessionState();
revived.restore(JSON.parse(JSON.stringify(state.snapshot())));
revived.snapshot().carts.dia === 'cart-abc'
  ? ok('snapshot round-trips through JSON')
  : die('snapshot', 'the cart id did not survive');

const where = await client.callTool({ name: 'where_am_i', arguments: {} });
where.content[0].text.includes('1425')
  ? ok('session state reaches the tool handlers')
  : die('session state', where.content[0].text);

if (process.argv.includes('--live')) {
  const t0 = Date.now();
  const res = await client.callTool(
    { name: 'set_location', arguments: { retailer: 'dia', postal_code: '1425' } },
    undefined,
    { timeout: 30_000 },
  );
  res.isError
    ? die('live set_location', res.content[0].text)
    : ok('live set_location', `${Date.now() - t0}ms — ${res.content[0].text.split('\n')[0]}`);
}

await client.close();
await server.close();
ok('closed cleanly');
console.log(process.exitCode ? '\nmcp smoke FAILED' : '\nmcp smoke passed');
