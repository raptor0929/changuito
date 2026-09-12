import type { Cart, LocationContext, Product } from '../types.js';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'discount';
  onlyAvailable?: boolean;
}

export interface RetailerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly host: string;

  resolveLocation(postalCode: string): Promise<LocationContext>;
  search(query: string, ctx: LocationContext, opts?: SearchOptions): Promise<Product[]>;
  getProduct(skuId: string, ctx: LocationContext): Promise<Product | null>;

  /** Read-only price + availability check. No cart is created. */
  priceCheck(
    items: Array<{ skuId: string; quantity: number; sellerId: string }>,
    ctx: LocationContext,
  ): Promise<Cart>;

  createCart(ctx: LocationContext): Promise<Cart>;
  getCart(cartId: string, ctx: LocationContext): Promise<Cart>;
  addItems(
    cartId: string,
    items: Array<{ skuId: string; quantity: number; sellerId: string }>,
    ctx: LocationContext,
  ): Promise<Cart>;
  setQuantity(cartId: string, index: number, quantity: number, ctx: LocationContext): Promise<Cart>;

  /** Where the human takes over. Must never place an order. */
  handoffUrl(cartId: string): string;
}
