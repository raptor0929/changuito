import type { Cart, CartLine } from '../types.js';
import { fromCentavos } from '../util/money.js';

/**
 * The VTEX orderForm, shared by the anonymous API adapter and the authenticated
 * browser flow — they speak to the same endpoint and get the same document
 * back, so the shape and the mapping live in one place.
 *
 * This is also the raw material for the Layer 1 classifier: the orderForm says
 * exactly which checkout step is satisfied and what is blocking the next one,
 * with no DOM inspection and no guessing.
 */

export interface VtexOrderFormItem {
  id: string;
  /** Present in a real orderForm; ABSENT from simulation responses. */
  name?: string;
  /** Simulation only: index back into the request's items array. */
  requestIndex?: number;
  quantity: number;
  seller: string;
  sellingPrice?: number; // centavos
  price?: number; // centavos
  listPrice?: number; // centavos
  availability?: string;
  isGift?: boolean;
  imageUrl?: string;
  measurementUnit?: string;
  unitMultiplier?: number;
}

export interface VtexClientProfile {
  email?: string;
  firstName?: string;
  lastName?: string;
  /** DNI. Día requires one at account creation, so it is already here. */
  document?: string;
  documentType?: string;
  phone?: string;
  isCorporate?: boolean;
}

export interface VtexAddress {
  addressId?: string;
  addressType?: string;
  receiverName?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  reference?: string;
  geoCoordinates?: number[];
}

export interface VtexLogisticsInfo {
  itemIndex?: number;
  selectedSla?: string | null;
  selectedDeliveryChannel?: string | null;
  slas?: Array<{
    id: string;
    name?: string;
    deliveryChannel?: string;
    price?: number;
    shippingEstimate?: string;
    availableDeliveryWindows?: Array<{ startDateUtc?: string; endDateUtc?: string; price?: number }>;
    deliveryWindow?: { startDateUtc?: string; endDateUtc?: string } | null;
  }>;
}

export interface VtexPayment {
  paymentSystem?: string;
  paymentSystemName?: string;
  value?: number;
  installments?: number;
  referenceValue?: number;
  bin?: string;
}

export interface VtexOrderForm {
  orderFormId?: string;
  salesChannel?: string | number;
  loggedIn?: boolean;
  canEditData?: boolean;
  items?: VtexOrderFormItem[];
  totalizers?: Array<{ id: string; name?: string; value: number }>;
  totals?: Array<{ id: string; name?: string; value: number }>;
  value?: number;
  messages?: Array<{ code?: string; text?: string; status?: string }>;
  clientProfileData?: VtexClientProfile | null;
  shippingData?: {
    address?: VtexAddress | null;
    availableAddresses?: VtexAddress[];
    logisticsInfo?: VtexLogisticsInfo[];
    selectedAddresses?: VtexAddress[];
  } | null;
  paymentData?: {
    payments?: VtexPayment[];
    availableAccounts?: unknown[];
    paymentSystems?: Array<{ id: number | string; name?: string; groupName?: string }>;
  } | null;
  /** Present once the order is placed. */
  orderGroup?: string;
}

export function toCart(of: VtexOrderForm, retailer: string, cartIdOverride?: string): Cart {
  const lines: CartLine[] = (of.items ?? []).map((it, index) => {
    const unit = it.sellingPrice ?? it.price ?? 0; // centavos
    return {
      index,
      skuId: it.id,
      name: it.name || `SKU ${it.id}`,
      quantity: it.quantity,
      sellerId: it.seller,
      unitPrice: fromCentavos(unit),
      lineTotal: fromCentavos(unit * it.quantity),
      available: it.availability ? it.availability === 'available' : true,
    };
  });

  const totalizers = of.totalizers ?? of.totals ?? [];
  const itemsTotal = totalizers.find((t) => t.id === 'Items')?.value;
  const total = itemsTotal ?? of.value ?? lines.reduce((s, l) => s + l.lineTotal.centavos, 0);

  return {
    retailer,
    cartId: cartIdOverride ?? of.orderFormId ?? '',
    lines,
    total: fromCentavos(total),
    messages: (of.messages ?? []).map((m) => m.text).filter((t): t is string => Boolean(t)),
  };
}

/**
 * What the user actually pays: items plus shipping plus discounts. `toCart`
 * deliberately reports the Items subtotal, because that is the number the
 * search and price tools mean; the checkout flow needs the other one.
 */
export function payableTotal(of: VtexOrderForm): number {
  const totalizers = of.totalizers ?? of.totals ?? [];
  if (typeof of.value === 'number' && of.value > 0) return Math.round(of.value);
  return Math.round(totalizers.reduce((s, t) => s + (t.value ?? 0), 0));
}

export function totalizerBreakdown(of: VtexOrderForm): Array<{ id: string; name: string; centavos: number }> {
  return (of.totalizers ?? of.totals ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? t.id,
    centavos: Math.round(t.value ?? 0),
  }));
}
