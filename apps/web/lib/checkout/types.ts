/** Wire shapes shared by app/api/checkout/* and CheckoutModal. Types only. */

export interface QuoteResponse {
  checkoutKind?: 'manual_fee_v1';
  orderNonce?: string;
  feeReleaseBasis?: 'checkout_prepared';
  viewerDurationSecs?: number;
  /** Present only when this quote is a manual checkout for a card member. */
  manualFlow?: 'viewer' | 'guided' | 'headless';
  resumeStatus?: StatusResponse;
  orderId: string;
  /** USDC base units (6 decimals), decimal string. */
  amount: string;
  amountCents: number;
  amountDisplay: string;
  basketHash: string;
  timeoutSecs: number;
  /** Pesos per USDC, and where it came from (belo · USDC, or the ARS_PER_USD override). */
  arsPerUsd: number;
  rateSource: string;
  /** Goods, envío and their sum, in centavos. The USDC amount is the sum at `arsPerUsd`. */
  subtotalCentavos: number;
  shippingCentavos: number;
  totalCentavos: number;
  /** Where the envío was quoted and the sandbox will deliver: the profile's postcode when saved, else the chat's. */
  postalCode: string;
  postalSource: 'profile' | 'chat';
  /** The chat's postcode, for the modal to say when the two differ. */
  chatPostalCode: string | null;
  programId: string;
  usdcMint: string;
  /**
   * Which run this checkout gets (lib/shared-card.ts `checkoutMode`): `live`
   * pays with the shared card and needs the Día login; `demo` stops at payment,
   * refunds and hands off to the cart link; `mock` is the operator's mock.
   */
  mode: 'live' | 'demo' | 'mock';
}

export type CheckoutStage = 'quoted' | 'locked' | 'shopping' | 'done' | 'refunded';

export interface StatusResponse {
  checkoutKind?: 'manual_fee_v1';
  manual?: import('./manual-policy.ts').ManualState;
  /** The flow stored on the order at start. Absent on older records, which stay on the remote browser. */
  manualFlow?: 'viewer' | 'guided' | 'headless';
  feeStatus?: 'escrowed' | 'settlement_pending' | 'settled' | 'refund_pending' | 'refunded';
  orderId: string;
  stage: CheckoutStage;
  /** The sandbox phase while shopping: login, empty_cart, shop, checkout, payment. */
  phase: string | null;
  /** What the store answered when the card was submitted: placed, declined, not_attempted, error. */
  payment: string | null;
  /** Día's order number, once placed. */
  storeOrderId: string | null;
  openSig: string | null;
  closeSig: string | null;
  /**
   * The store's cart link: on `done`, and on `refunded` so the shopper can
   * finish the purchase in Día themselves — which is the whole point of a demo run.
   */
  handoffUrl: string | null;
  amountDisplay: string;
  error: string | null;
  /** Which run this was (QuoteResponse `mode`); null on records from before it existed. */
  mode: 'live' | 'demo' | 'mock' | null;
  /**
   * Something the shopper should know while the order is still open
   * (lib/checkout/resolver-alert.ts): the resolver could not settle or refund,
   * or the run is taking far longer than it should. Null when all is well.
   */
  alert: CheckoutAlert | null;
}

export type CheckoutAlert = 'resolver_failed' | 'stuck';

export interface OrderLine {
  orderId: string;
  amountDisplay: string;
  status: 'open' | 'settled' | 'refunded';
  openedAt: number;
  explorer: string;
}
