import { request, serialized } from '../util/http.js';
import { fromCentavos, fromPesos } from '../util/money.js';
import { type VtexOrderForm, toCart } from './orderform.js';
import { RetailerError } from '../types.js';
import type { Cart, LocationContext, Product, Seller } from '../types.js';
import type { RetailerAdapter, SearchOptions } from './types.js';

export interface VtexStoreConfig {
  id: string;
  displayName: string;
  host: string;
  locale: string;
  /**
   * Only set this to pin a value. Leave undefined and the adapter discovers the
   * real sales channel from an anonymous orderForm, which is what you want:
   * Cencosud stores run on 32, and passing 1 makes Intelligent Search return
   * zero results with no error at all.
   */
  salesChannel?: string;
}

// ---- upstream response shapes (only the fields we rely on) ----

interface VtexSeller {
  sellerId: string;
  sellerDefault?: boolean;
  commertialOffer?: {
    Price?: number;          // pesos
    ListPrice?: number;      // centavos, despite sitting beside Price
    AvailableQuantity?: number;
    IsAvailable?: boolean;
  };
}
interface VtexItem {
  itemId: string;
  name?: string;
  ean?: string;
  images?: Array<{ imageUrl?: string }>;
  sellers?: VtexSeller[];
  unitMultiplier?: number;
  measurementUnit?: string;
}
interface VtexProduct {
  productId: string;
  productName: string;
  brand?: string;
  link?: string;
  linkText?: string;
  categories?: string[];
  items?: VtexItem[];
}
interface VtexSearchResponse {
  products?: VtexProduct[];
  recordsFiltered?: number;
  /** Set when the store redirects this term to a category page instead of answering it. */
  redirect?: string;
}
interface VtexRegion {
  id: string;
  sellers?: Array<{ id: string; name?: string }>;
}

const SORT_MAP: Record<NonNullable<SearchOptions['sort']>, string> = {
  relevance: '',
  price_asc: 'price:asc',
  price_desc: 'price:desc',
  discount: 'discount:desc',
};

/**
 * `commertialOffer.ListPrice` has no consistent unit across Argentine VTEX stores.
 * Verified live 2026-09-17 on the same query:
 *
 *   Disco     sku 392452  Price 2915.0   ListPrice 291500.0   <- centavos
 *   Carrefour sku 144371  Price 2190.0   ListPrice   2915.0   <- pesos
 *
 * So there is no safe global divisor, and getting it wrong shows the user a
 * "was $29,15" strikethrough on a $2.915 product. A list price is never ~50x the
 * selling price, so that ratio separates the two cases unambiguously.
 *
 * Stale list prices also occur (Disco sku 391068: Price 3150, ListPrice 260331 ->
 * 2603.31, BELOW the selling price). Those are dropped rather than rendered as a
 * negative discount.
 */
function normalizeListPrice(listPrice: number | undefined, pricePesos: number) {
  if (listPrice == null || listPrice <= 0) return undefined;
  const pesos = pricePesos > 0 && listPrice > pricePesos * 50 ? listPrice / 100 : listPrice;
  return pesos > pricePesos ? fromPesos(pesos) : undefined;
}

export class VtexAdapter implements RetailerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly host: string;
  private readonly locale: string;
  private pinnedSalesChannel?: string;
  private discoveredSalesChannel?: string;

  constructor(cfg: VtexStoreConfig) {
    this.id = cfg.id;
    this.displayName = cfg.displayName;
    this.host = cfg.host;
    this.locale = cfg.locale;
    this.pinnedSalesChannel = cfg.salesChannel;
  }

  private base(path: string): string {
    return `https://${this.host}${path}`;
  }

  /**
   * The single most important call in this adapter. An anonymous orderForm
   * reports the store's real sales channel. Hardcoding 1 breaks Jumbo and Disco
   * silently — search returns an empty list and the cart rejects every SKU with
   * ORD027 "no encontrado o no disponible" even though stock is 99999.
   */
  private async salesChannel(): Promise<string> {
    if (this.pinnedSalesChannel) return this.pinnedSalesChannel;
    if (this.discoveredSalesChannel) return this.discoveredSalesChannel;
    try {
      // GET only. This well-known id is NOT a throwaway: it is a real, shared cart
      // that anyone can write to, and it was observed holding 2 items left there by
      // other clients. We read salesChannel off it and never POST to it — writing
      // would put the user's groceries in a cart strangers can see and edit.
      const of = await request<VtexOrderForm>(
        this.base('/api/checkout/pub/orderForm/00000000000000000000000000000000'),
      );
      this.discoveredSalesChannel = String(of.salesChannel ?? 1);
    } catch {
      this.discoveredSalesChannel = '1';
    }
    return this.discoveredSalesChannel;
  }

  async resolveLocation(postalCode: string): Promise<LocationContext> {
    const sc = await this.salesChannel();
    const common = { retailer: this.id, country: 'ARG', postalCode, salesChannel: sc };

    try {
      const regions = await request<VtexRegion[]>(
        this.base(`/api/checkout/pub/regions?country=ARG&postalCode=${encodeURIComponent(postalCode)}`),
        { retries: 1 },
      );
      const r = regions?.[0];
      if (r?.id) {
        const sellers: Seller[] = (r.sellers ?? []).map((s) => ({ id: s.id, name: s.name || s.id }));
        return { ...common, regionId: r.id, sellers, degraded: false };
      }
      return {
        ...common, sellers: [], degraded: true,
        note: `${this.displayName} returned no delivery region for ${postalCode}. Prices are national defaults and may differ from your branch.`,
      };
    } catch {
      // Cencosud stores (Jumbo, Disco) fail here with ORD021.6 for every param
      // shape. Degrade rather than block: search and cart still work on sc alone.
      return {
        ...common, sellers: [], degraded: true,
        note: `${this.displayName} does not expose delivery regions through its public API, so prices shown are national defaults for sales channel ${sc} rather than your specific branch.`,
      };
    }
  }

  async search(query: string, ctx: LocationContext, opts: SearchOptions = {}): Promise<Product[]> {
    const limit = Math.min(opts.limit ?? 12, 50);
    const offset = opts.offset ?? 0;
    const p = new URLSearchParams({ query, locale: this.locale });

    // `count` alone is ignored by v1 — it silently returns the default 24.
    // `from`/`to` is the form that actually works.
    p.set('from', String(offset));
    p.set('to', String(offset + limit - 1));
    p.set('sc', ctx.salesChannel);
    if (ctx.regionId) p.set('regionId', ctx.regionId);
    const sort = SORT_MAP[opts.sort ?? 'relevance'];
    if (sort) p.set('sort', sort);

    // Deliberately NOT sending hideUnavailableItems. Verified 2026-09-17: on Disco
    // it returns 0 results for every query (even bare "leche", which otherwise has
    // 635), while the per-seller AvailableQuantity in the same response is correct.
    // Filtering locally is portable and costs nothing.
    const res = await request<VtexSearchResponse>(
      this.base(`/api/intelligent-search/v1/product-search/?${p}`),
    );
    let all = (res.products ?? []).flatMap((prod) => this.toProducts(prod));

    // Merchandising redirect: the store maps this exact term to a category page,
    // so Intelligent Search answers with zero products and a `redirect` path. A
    // browser navigates; a headless client just sees nothing. Verified on
    // Carrefour: query "cafe" -> 0 results + redirect "/Desayuno-y-merienda/Cafe",
    // while "cafe la virginia" returns 117. Neither the path form nor map=c,c
    // recovers it, but the legacy catalog full-text search does.
    if (!all.length && res.redirect) {
      all = await this.catalogFulltext(query, ctx, limit, offset);
    }

    return (opts.onlyAvailable ?? true) ? all.filter((x) => x.available) : all;
  }

  async getProduct(skuId: string, ctx: LocationContext): Promise<Product | null> {
    const p = new URLSearchParams({ query: `sku:${skuId}`, locale: this.locale, sc: ctx.salesChannel });
    if (ctx.regionId) p.set('regionId', ctx.regionId);
    const res = await request<VtexSearchResponse>(
      this.base(`/api/intelligent-search/v1/product-search/?${p}`),
    );
    const all = (res.products ?? []).flatMap((prod) => this.toProducts(prod));
    return all.find((x) => x.skuId === skuId) ?? all[0] ?? null;
  }

  /**
   * Legacy catalog full-text search. Only used to recover from a redirect rule.
   * Note it is NOT regionalized and ignores regionId, so results are checked
   * against simulation before anything is added to a cart.
   */
  private async catalogFulltext(
    query: string,
    ctx: LocationContext,
    limit: number,
    offset: number,
  ): Promise<Product[]> {
    const p = new URLSearchParams({
      ft: query,
      _from: String(offset),
      _to: String(offset + limit - 1),
      sc: ctx.salesChannel,
    });
    try {
      const rows = await request<VtexProduct[]>(
        this.base(`/api/catalog_system/pub/products/search/?${p}`),
      );
      return (rows ?? []).flatMap((prod) => this.toProducts(prod));
    } catch {
      return []; // the redirect fallback is best-effort; never fail the search over it
    }
  }

  private toProducts(p: VtexProduct): Product[] {
    return (p.items ?? []).map((item) => {
      const seller =
        item.sellers?.find((s) => s.sellerDefault) ?? item.sellers?.[0] ?? { sellerId: '1' };
      const co = seller.commertialOffer ?? {};
      return {
        skuId: item.itemId,
        productId: p.productId,
        name: item.name || p.productName,
        brand: p.brand,
        ean: item.ean,
        sellerId: seller.sellerId,
        // commertialOffer.Price is PESOS everywhere. ListPrice is NOT — see normalizeListPrice.
        price: fromPesos(co.Price ?? 0),
        listPrice: normalizeListPrice(co.ListPrice, co.Price ?? 0),
        available: (co.AvailableQuantity ?? 0) > 0,
        availableQuantity: co.AvailableQuantity,
        imageUrl: item.images?.[0]?.imageUrl,
        url: p.link ?? (p.linkText ? `https://${this.host}/${p.linkText}/p` : undefined),
        categories: p.categories,
        unitMultiplier: item.unitMultiplier,
        measurementUnit: item.measurementUnit,
      };
    });
  }

  async priceCheck(
    items: Array<{ skuId: string; quantity: number; sellerId: string; name?: string }>,
    ctx: LocationContext,
  ): Promise<Cart> {
    // RnbBehavior=0 means "cart stage": all promotions apply. The default, 1,
    // under-reports discounts and quotes the user a higher price than reality.
    const of = await request<VtexOrderForm>(
      this.base(`/api/checkout/pub/orderForms/simulation?sc=${ctx.salesChannel}&RnbBehavior=0`),
      {
        method: 'POST',
        body: {
          items: items.map((i) => ({ id: i.skuId, quantity: i.quantity, seller: i.sellerId })),
          country: ctx.country,
          postalCode: ctx.postalCode,
        },
      },
    );
    // Simulation responses carry prices but NO product names (verified: an item's
    // keys are id/price/sellingPrice/listPrice/availability/... and itemMetadata
    // comes back empty). Overlay the caller's names via requestIndex so the quote
    // is readable instead of a wall of SKU numbers.
    const quote = this.toCart(of, '(simulation — no cart created)');
    for (const [i, line] of quote.lines.entries()) {
      const src = items[of.items?.[i]?.requestIndex ?? i] ?? items[i];
      if (src?.name) line.name = src.name;
    }
    return quote;
  }

  async createCart(ctx: LocationContext): Promise<Cart> {
    // Documented form. The widely-copied POST /orderForm is absent from VTEX's spec.
    const of = await request<VtexOrderForm>(
      this.base(`/api/checkout/pub/orderForm?forceNewCart=true&sc=${ctx.salesChannel}`),
    );
    if (!of.orderFormId) throw new RetailerError('Store did not return a cart id', 'UPSTREAM');
    return this.toCart(of);
  }

  async getCart(cartId: string, _ctx: LocationContext): Promise<Cart> {
    const of = await request<VtexOrderForm>(
      this.base(`/api/checkout/pub/orderForm/${cartId}?refreshOutdatedData=true`),
    );
    return this.toCart(of);
  }

  async addItems(
    cartId: string,
    items: Array<{ skuId: string; quantity: number; sellerId: string; name?: string }>,
    ctx: LocationContext,
  ): Promise<Cart> {
    return serialized(`${this.id}:${cartId}`, async () => {
      const of = await request<VtexOrderForm>(
        this.base(`/api/checkout/pub/orderForm/${cartId}/items?sc=${ctx.salesChannel}`),
        {
          method: 'POST',
          retries: 0, // never blind-retry a write
          body: {
            orderItems: items.map((i) => ({
              id: i.skuId,
              quantity: i.quantity,
              seller: i.sellerId,
            })),
          },
        },
      );
      const cart = this.toCart(of);
      for (const it of items) {
        if (!cart.lines.some((l) => l.skuId === it.skuId)) {
          throw new RetailerError(
            `${this.displayName} did not accept SKU ${it.skuId}`,
            'OUT_OF_STOCK',
            cart.messages.join(' ') ||
              'The SKU may not be sold on this sales channel or in this delivery region.',
          );
        }
      }
      return cart;
    });
  }

  async setQuantity(
    cartId: string,
    index: number,
    quantity: number,
    _ctx: LocationContext,
  ): Promise<Cart> {
    return serialized(`${this.id}:${cartId}`, async () => {
      // Lines are addressed by array index, not SKU. Quantity 0 removes.
      const of = await request<VtexOrderForm>(
        this.base(`/api/checkout/pub/orderForm/${cartId}/items/update`),
        { method: 'POST', retries: 0, body: { orderItems: [{ index, quantity }] } },
      );
      return this.toCart(of);
    });
  }

  private toCart(of: VtexOrderForm, cartIdOverride?: string): Cart {
    return toCart(of, this.id, cartIdOverride);
  }

  handoffUrl(cartId: string): string {
    // Hands the cart to the human. The deep-link form
    // /checkout/cart/add?sku=..&qty=.. is 404 on all four of these VTEX IO
    // storefronts (verified with a valid SKU), so this is the only route.
    return `https://${this.host}/checkout/?orderFormId=${cartId}#/cart`;
  }
}
