import type { Cart, LocationContext } from './types.js';
import { getAdapter } from './adapters/registry.js';

/**
 * Per-process state. An MCP server over stdio serves exactly one user, so a
 * module-level store is appropriate — but it is deliberately explicit rather
 * than scattered through the tools, so swapping it for real persistence later
 * is a one-file change.
 */
interface State {
  location?: LocationContext;
  /** retailer id -> cart id */
  carts: Map<string, string>;
}

const state: State = { carts: new Map() };

export function setLocation(ctx: LocationContext): void {
  if (state.location && state.location.retailer !== ctx.retailer) {
    // Prices and cart ids are per-retailer; keeping old carts around invites
    // handing the user a link to a cart from a different supermarket.
    state.carts.clear();
  }
  state.location = ctx;
}

export function requireLocation(): LocationContext {
  if (!state.location) {
    throw new Error(
      'No location set. Call set_location with a retailer and an Argentine postal code first — ' +
        'prices and stock in Argentina vary by branch, so results are meaningless without it.',
    );
  }
  return state.location;
}

export function getLocation(): LocationContext | undefined {
  return state.location;
}

/** Returns the current cart for the active retailer, creating one on first use. */
export async function ensureCart(): Promise<{ cart: Cart; ctx: LocationContext }> {
  const ctx = requireLocation();
  const adapter = getAdapter(ctx.retailer);
  const existing = state.carts.get(ctx.retailer);
  if (existing) {
    try {
      return { cart: await adapter.getCart(existing, ctx), ctx };
    } catch {
      state.carts.delete(ctx.retailer); // stale or expired — fall through and make a new one
    }
  }
  const cart = await adapter.createCart(ctx);
  state.carts.set(ctx.retailer, cart.cartId);
  return { cart, ctx };
}

export function rememberCart(retailer: string, cartId: string): void {
  state.carts.set(retailer, cartId);
}
