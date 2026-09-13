#!/usr/bin/env node
/**
 * The stdio binary. Everything it does lives in `server.ts`; this file exists
 * only to pick a transport, which is the one thing a library cannot decide for
 * its host.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSupermercadoServer } from './server.js';

const server = await createSupermercadoServer();
await server.connect(new StdioServerTransport());

// stdout is the JSON-RPC channel. Anything human-readable goes to stderr.
console.error(
  'supermercado-mcp ready — search, cart, and Día checkout with a single-use funded card',
);
