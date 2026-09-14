#!/usr/bin/env node
/**
 * The stdio binary: a full server, checkout included.
 *
 * It is the only place the checkout tools are imported, which is what keeps
 * them out of every other host. Everything else lives in `server.ts`; this
 * file picks a transport, which is the one thing a library cannot decide for
 * its host.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { SERVER_INSTRUCTIONS } from './onboarding.js';
import { createSupermercadoServer } from './server.js';
import { registerCheckoutTools } from './tools.js';

// The full instructions, because this process registers the full tool set.
const server = createSupermercadoServer({ instructions: SERVER_INSTRUCTIONS });
registerCheckoutTools(server);

await server.connect(new StdioServerTransport());
console.error('supermercado-mcp ready \u2014 search, cart, and D\u00eda checkout with a single-use funded card');
