import type { Cart, LocationContext } from './types.js';
import { getAdapter } from './adapters/registry.js';

/**
 * Per-session state.
 *
 * Over stdio one process serves exactly one user, so this was a module-level
 * store. A web host is the opposite: one process serves many users at once,
 * and a shared `location` means two shoppers silently overwrite each other's
 * supermarket. So the state is a value now, and the module-level one is just
 * the default instance the stdio binary uses.
 *
 * `snapshot`/`restore` exist because a serverless instance is not durable. The
 * cart lives at the retailer under an id we hold; lose the id and `ensureCart`
 * quietly mints an empty replacement and hands the user a link to it. That is
 * a wrong answer with no error, which is the worst kind, so the id has to
 * survive the process that created it.
 */
export interface SessionSnapshot {
  location?: LocationContext;
  /** retailer id -> cart id */
  carts: Record<string, string>;
}

export interface SessionState {
  setLocation(ctx: LocationContext): void;
  requireLocation(): LocationContext;
  getLocation(): LocationContext | undefined;
  ensureCart(): Promise<{ cart: Cart; ctx: LocationContext }>;
  rememberCart(retailer: string, cartId: string): void;
  snapshot(): SessionSnapshot;
  restore(snap: SessionSnapshot): void;
}

export function createSessionState(): SessionState {
  let location: LocationContext | undefined;
  const carts = new Map<string, string>();

  const requireLocation = (): LocationContext => {
    if (!location) {
      throw new Error(
        'No location set. Call set_location with a retailer and an Argentine postal code first — ' +
          'prices and stock in Argentina vary by branch, so results are meaningless without it.',
      );
    }
    return location;
  };

  return {
    setLocation(ctx) {
      if (location && location.retailer !== ctx.retailer) {
        // Prices and cart ids are per-retailer; keeping old carts around invites
        // handing the user a link to a cart from a different supermarket.
        carts.clear();
      }
      location = ctx;
    },

    requireLocation,
    getLocation: () => location,

    /** Returns the current cart for the active retailer, creating one on first use. */
    async ensureCart() {
      const ctx = requireLocation();
      const adapter = getAdapter(ctx.retailer);
      const existing = carts.get(ctx.retailer);
      if (existing) {
        try {
          return { cart: await adapter.getCart(existing, ctx), ctx };
        } catch {
          carts.delete(ctx.retailer); // stale or expired — fall through and make a new one
        }
      }
      const cart = await adapter.createCart(ctx);
      carts.set(ctx.retailer, cart.cartId);
      return { cart, ctx };
    },

    rememberCart(retailer, cartId) {
      carts.set(retailer, cartId);
    },

    snapshot: () => ({ location, carts: Object.fromEntries(carts) }),

    restore(snap) {
      location = snap.location;
      carts.clear();
      for (const [retailer, cartId] of Object.entries(snap.carts ?? {})) {
        carts.set(retailer, cartId);
      }
    },
  };
}

/**
 * The instance the stdio binary and the checkout tools use. Keeping these
 * free functions means `tools.ts` and every existing test compile unchanged;
 * only a host that needs more than one session has to know about the factory.
 */
export const defaultSession: SessionState = createSessionState();

export const setLocation = (ctx: LocationContext): void => defaultSession.setLocation(ctx);
export const requireLocation = (): LocationContext => defaultSession.requireLocation();
export const getLocation = (): LocationContext | undefined => defaultSession.getLocation();
export const ensureCart = (): Promise<{ cart: Cart; ctx: LocationContext }> =>
  defaultSession.ensureCart();
export const rememberCart = (retailer: string, cartId: string): void =>
  defaultSession.rememberCart(retailer, cartId);
