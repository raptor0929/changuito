/**
 * Wallet signing for auth entries and classic transactions, as pure functions.
 *
 * The React hook in `use-wallet-signers.ts` is a thin wrapper around these.
 * Unit tests call them with a fake client — Node's strip-types runner cannot
 * resolve React, and a signing result must be branchable without a DOM.
 *
 * Both call sites return a result the caller can switch on. A user rejection
 * (or any thrown error from the wallet) becomes `{ status: 'error' }`; nothing
 * here rethrows.
 */

/** What {@link signAuthEntryWith} returns. Mirrors Pollar's SignAuthEntryOutcome. */
export type AuthEntryResult =
  | { status: 'signed'; signedAuthEntry: string }
  | { status: 'error'; details?: string };

/** What {@link signTransactionWith} returns. Mirrors Pollar's SignOutcome. */
export type TxSignResult =
  | { status: 'signed'; signedXdr: string }
  | { status: 'error'; details?: string; code?: string; message?: string };

/** The slice of PollarClient these helpers need. */
export interface WalletSignClient {
  signAuthEntry(
    entryXdr: string,
    options: { validUntilLedger: number },
  ): Promise<AuthEntryResult>;
  /**
   * Pollar names this `signTx`. The hook exposes it as `signTransaction` so
   * callers (#6) do not have to know Pollar's internal name.
   */
  signTx(unsignedXdr: string): Promise<TxSignResult>;
}

function asErrorDetails(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sign a Soroban authorization entry (Channels fee-payer path, #2).
 *
 * `validUntilLedger` is required by Pollar for the custodial path; Freighter
 * sets its own expiration and ignores it.
 */
export async function signAuthEntryWith(
  client: WalletSignClient,
  entryXdr: string,
  options: { validUntilLedger: number },
): Promise<AuthEntryResult> {
  try {
    return await client.signAuthEntry(entryXdr, options);
  } catch (err) {
    return { status: 'error', details: asErrorDetails(err) };
  }
}

/**
 * Sign a classic / Soroban transaction envelope (sponsored account + trustline, #6).
 */
export async function signTransactionWith(
  client: WalletSignClient,
  unsignedXdr: string,
): Promise<TxSignResult> {
  try {
    return await client.signTx(unsignedXdr);
  } catch (err) {
    return { status: 'error', details: asErrorDetails(err) };
  }
}
