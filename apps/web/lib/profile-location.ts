/**
 * The chat's delivery area from the shopper's saved profile.
 *
 * Every new basket used to open with "¿cuál es tu código postal?", even for
 * a shopper whose profile already says where they live. So before a turn
 * runs, a signed-in shopper whose session has no location yet gets one: the
 * profile's postcode, at Día — the store the checkout buys from. It goes
 * through the MCP server's own `set_location`, so the location is resolved
 * exactly as if the model had asked and the shopper had answered; the
 * agent's state banner then shows it and `early-ask` stays quiet.
 *
 * Best effort and silent: no profile, no postcode, an unreadable profile or a
 * postcode the store will not resolve all leave the session as it was, and
 * the model asks as before. The shopper can still name another store or area
 * in the chat; `set_location` simply runs again.
 *
 * Only the postcode leaves `getProfile` here. The rest of the decrypted
 * profile (the Día login) is dropped with the local.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { getProfile } from './profile.ts';

const POSTCODE = /^[A-Za-z]?\d{4}([A-Za-z]{3})?$/;

export async function presetLocationFromProfile(
  session: { client: Client; state: { getLocation(): unknown } },
  address: string,
): Promise<boolean> {
  if (session.state.getLocation()) return false;
  try {
    const postcode = (await getProfile(address))?.postcode?.trim();
    if (!postcode || !POSTCODE.test(postcode)) return false;
    const res = await session.client.callTool(
      { name: 'set_location', arguments: { retailer: 'dia', postal_code: postcode } },
      undefined,
      { timeout: 20_000 },
    );
    return res.isError !== true && Boolean(session.state.getLocation());
  } catch (err) {
    console.warn('[chat] profile location', err instanceof Error ? err.name : 'failed');
    return false;
  }
}
