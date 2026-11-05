import { env } from "cloudflare:workers";
import handler from "vinext/server/fetch-handler";

/**
 * Worker entry. The app keeps reading DATABASE_URL. Hyperdrive's connection
 * string is copied onto that name before the request, so the pages and the
 * tests do not import cloudflare:workers.
 */
const fetchHandler = handler as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
};

export default {
  fetch(request: Request, cfEnv: unknown, ctx: unknown) {
    const binding = (env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE;
    const url = binding?.connectionString?.trim();
    if (url) {
      process.env.DATABASE_URL = url;
      // New id per request so the cached Postgres client is not reused after
      // Hyperdrive has closed the previous socket.
      process.env.CHG_DB_REQUEST = crypto.randomUUID();
    }
    return fetchHandler.fetch(request, cfEnv, ctx);
  },
};
