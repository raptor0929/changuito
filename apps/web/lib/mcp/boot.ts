import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSupermercadoServer } from '@changuito/mcp/server';
import { createSessionState, type SessionState } from '@changuito/mcp/session';

/**
 * A real MCP client and a real MCP server, in one process, talking over a
 * linked pair of in-memory transports.
 *
 * The alternative — importing the tool functions and calling them directly —
 * would be shorter and would be a lie: the point of this app is to show what
 * the MCP server does, so the protocol has to actually be on the wire, even
 * when the wire is a pair of queues. `tools/list` and `tools/call` are the
 * same round trips Claude Desktop makes.
 *
 * Spawning the published binary as a subprocess would also be real MCP, but
 * the binary registers the checkout tools, which drive a headed browser on the
 * server host. That cannot run on Vercel. `@changuito/mcp/server` is the half
 * that can: it has no path to the checkout module at all.
 */
export interface McpPair {
  client: Client;
  server: McpServer;
  state: SessionState;
}

export async function bootMcp(): Promise<McpPair> {
  const state = createSessionState();
  const server = createSupermercadoServer({ session: state });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'changuito-web', version: '0.1.0' }, { capabilities: {} });

  // Both sides connect concurrently. `client.connect` sends `initialize` and
  // waits for the reply, so awaiting it before the server is listening is a
  // deadlock waiting for a scheduling accident to save it.
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server, state };
}

export async function closeMcp(pair: McpPair): Promise<void> {
  await pair.client.close();
  await pair.server.close();
}
