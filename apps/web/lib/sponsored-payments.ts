/**
 * What a sponsored shopper account must look like after an escrow payment
 * with 0 XLM of its own (D1 evidence).
 *
 * The route that builds the sponsored createAccount + trustline lives on
 * issue 6. This module only names the acceptance check and keeps a recorder
 * from locking reserves twice for the same address.
 */

/** Label Stellar Expert shows when Changuito's sponsor account paid the reserves. */
export const CHANGITO_SPONSOR = 'Changuito';

export interface SponsoredPaymentRecord {
  address: string;
  /** Who locked the account and trustline reserves. */
  sponsor: string;
  /** Classic USDC trustline is open. */
  usdcTrustline: boolean;
  /** Native balance the account itself owns — not the sponsored reserve. */
  ownXlm: string;
  /** Escrow payment identifier once Channels has recorded one. */
  escrowPayment: string | null;
  /** When sponsorship was first recorded, or null if never. */
  sponsoredAt: number | null;
}

/** Where sponsorship and payment evidence is stored. Tests use a fake. */
export interface SponsoredPaymentRecorder {
  get(address: string): SponsoredPaymentRecord | undefined;
  put(record: SponsoredPaymentRecord): void;
}

/**
 * True when the record matches the D1 acceptance check: Changuito sponsored
 * the account, the USDC trustline exists, own XLM is 0, and an escrow
 * payment is on the record.
 */
export function passesSponsoredPaymentCheck(record: SponsoredPaymentRecord): boolean {
  return (
    record.sponsor === CHANGITO_SPONSOR &&
    record.usdcTrustline === true &&
    record.ownXlm === '0' &&
    typeof record.escrowPayment === 'string' &&
    record.escrowPayment.length > 0
  );
}

/**
 * Create the sponsored account + trustline entry once. A second call for the
 * same address returns the existing record and does not sponsor again.
 */
export function ensureSponsored(
  recorder: SponsoredPaymentRecorder,
  address: string,
  now = Date.now(),
): { record: SponsoredPaymentRecord; sponsored: boolean } {
  const existing = recorder.get(address);
  if (existing?.sponsoredAt != null) {
    return { record: existing, sponsored: false };
  }
  const record: SponsoredPaymentRecord = {
    address,
    sponsor: CHANGITO_SPONSOR,
    usdcTrustline: true,
    ownXlm: '0',
    escrowPayment: existing?.escrowPayment ?? null,
    sponsoredAt: now,
  };
  recorder.put(record);
  return { record, sponsored: true };
}

/** Attach an escrow payment to an already-sponsored account. */
export function recordEscrowPayment(
  recorder: SponsoredPaymentRecorder,
  address: string,
  paymentId: string,
): SponsoredPaymentRecord {
  const existing = recorder.get(address);
  if (!existing || existing.sponsoredAt == null) {
    throw new Error(`account ${address} is not sponsored`);
  }
  const record: SponsoredPaymentRecord = { ...existing, escrowPayment: paymentId };
  recorder.put(record);
  return record;
}
