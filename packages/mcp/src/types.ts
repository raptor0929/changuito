/** Money is always held as integer centavos. See note in util/money.ts. */
export type Centavos = number;

export interface Money {
  centavos: Centavos;
  /** Pre-formatted for display, e.g. "$3.150,00" — AR locale. */
  display: string;
}

export interface Product {
  /** The SKU id. THIS is what add_to_cart takes — not productId. */
  skuId: string;
  productId: string;
  name: string;
  brand?: string;
  ean?: string;
  /** Seller that offers this SKU. Never assume "1". */
  sellerId: string;
  price: Money;
  listPrice?: Money;
  available: boolean;
  /** Units in stock, when the store reports it. */
  availableQuantity?: number;
  imageUrl?: string;
  url?: string;
  categories?: string[];
  unitMultiplier?: number;
  measurementUnit?: string;
}

export interface CartLine {
  /** Position in the store's cart array. items/update addresses lines by THIS, not by skuId. */
  index: number;
  skuId: string;
  name: string;
  quantity: number;
  sellerId: string;
  unitPrice: Money;
  lineTotal: Money;
  available: boolean;
}

export interface Cart {
  retailer: string;
  cartId: string;
  lines: CartLine[];
  total: Money;
  /** Non-fatal notices from the store: out of stock, price changed, promo applied. */
  messages: string[];
}

export interface Seller {
  id: string;
  name: string;
}

/** Everything needed to make prices and availability match what the user will actually pay. */
export interface LocationContext {
  retailer: string;
  country: string;
  postalCode: string;
  /** VTEX region token. Absent on stores whose /regions endpoint is broken (Cencosud). */
  regionId?: string;
  sellers: Seller[];
  /** Discovered from the store, never hardcoded. */
  salesChannel: string;
  /** True when the store could not regionalize and prices are national defaults. */
  degraded: boolean;
  /** Human-readable explanation when degraded. */
  note?: string;
}

export class RetailerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'SKU_NOT_FOUND'
      | 'OUT_OF_STOCK'
      | 'REGION_UNAVAILABLE'
      | 'CART_NOT_FOUND'
      | 'RATE_LIMITED'
      | 'UPSTREAM'
      | 'NOT_IMPLEMENTED',
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'RetailerError';
  }
}

/**
 * A delivery address as the user gives it in chat. Deliberately separate from
 * VTEX's address shape: this is what a person says, not what the API stores.
 * Name and DNI are never in here — those are read from the user's own profile.
 */
export interface DeliveryAddress {
  street: string;
  number: string;
  /** Piso / depto. */
  complement?: string;
  city?: string;
  state?: string;
  postalCode: string;
  /** Entre calles, "portón verde" — whatever helps the driver find it. */
  reference?: string;
  phone?: string;
  receiverName?: string;
}
