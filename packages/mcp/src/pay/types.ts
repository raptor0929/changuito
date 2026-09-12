/**
 * Vyrion holds money in USD and hands it back as a JSON float ("balance": 142.5).
 * We convert at the boundary and hold integer cents everywhere inside, for the
 * same reason the retailer side holds integer centavos: 0.1 + 0.2 !== 0.3, and
 * this is the number that decides how much of someone's money moves.
 */
export type UsdCents = number;

export type CardStatus = 'active' | 'frozen' | 'terminated';

export interface Bin {
  id: string;
  network: string;
  type: string;
  /** Whether cards on this BIN are enrolled in 3D Secure. We require true. */
  '3ds': boolean;
  apple_pay?: boolean;
  google_pay?: boolean;
  max_transaction?: number;
  max_monthly?: number;
  /** Vyrion's own figure, 0..1 or 0..100 depending on the account. Normalised on read. */
  acceptance_rate?: number;
  best_for?: string;
}

export interface Card {
  id: string;
  bin_id: string;
  network: string;
  last4: string;
  status: CardStatus;
  balance: number;
  spending_limit?: number;
  label?: string;
  allowed_categories?: string[];
  auto_freeze_at?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

/**
 * PCI-sensitive. Every field here is registered with the redactor the instant it
 * arrives and forgotten the instant the payment step ends. It is never written
 * to disk, never returned through MCP, and never included in a Playwright trace.
 */
export interface CardDetails {
  id: string;
  /** Full card number. */
  pan: string;
  cvv: string;
  /** Two digits. */
  expiry_month: string;
  /** Four digits on this API; the form may want two. */
  expiry_year: string;
  cardholder_name?: string;
}

export interface WalletBalance {
  /** Settled, spendable. */
  balance: number;
  currency: string;
  /** Deposits seen on-chain but not yet confirmed. NEVER counted as spendable. */
  pending_deposits: number;
  total_deposited?: number;
  total_spent?: number;
  cards_active?: number;
  cards_total_balance?: number;
}

export interface DepositAddress {
  currency: string;
  address: string;
  network?: string;
  memo?: string;
}

export interface Transaction {
  id: string;
  card_id: string;
  type: 'authorization' | 'settlement' | 'refund' | 'decline';
  merchant?: string;
  amount: number;
  currency?: string;
  status?: string;
  decline_reason?: string;
  created_at: string;
}

/** A pending 3DS challenge, including the OTP. Expires in roughly three minutes. */
export interface ThreeDsChallenge {
  id: string;
  card_id: string;
  merchant: string;
  amount: number;
  otp: string;
  status: string;
  expires_at: string;
}

export class VyrionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'VyrionError';
  }
}
