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

/** Pollar's SignAuthEntryOutcome. */
export type WalletAuthEntryOutcome =
  | { status: 'signed'; signedAuthEntry: string }
  | { status: 'error'; details?: string };

/**
 * What {@link signAuthEntryWith} returns. `signature` is a wallet that signed
 * the entry's payload and returned the bare signature, base64, not an entry.
 */
export type AuthEntryResult =
  | WalletAuthEntryOutcome
  | { status: 'signature'; signature: string };

/** Pollar's id for its Freighter adapter (`WalletType.FREIGHTER`). */
const FREIGHTER = 'freighter-native';

/** What {@link signTransactionWith} returns. Mirrors Pollar's SignOutcome. */
export type TxSignResult =
  | { status: 'signed'; signedXdr: string }
  | { status: 'error'; details?: string; code?: string; message?: string };

/** The slice of PollarClient these helpers need. */
export interface WalletSignClient {
  signAuthEntry(
    entryXdr: string,
    options: { validUntilLedger: number },
  ): Promise<WalletAuthEntryOutcome>;
  /** The connected external wallet's adapter id. Null for a custodial session. */
  getWalletType?(): string | null;
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
 * `validUntilLedger` is required by Pollar for the custodial path, which signs
 * the entry and returns it signed.
 *
 * Freighter is different on both ends. Its `signAuthEntry` takes the payload
 * the entry hashes to (a `HashIdPreimage`), not the entry, and returns the
 * signature alone. Pollar hands it whatever string it is given, so an entry
 * went in and Freighter refused to parse it. With Freighter connected the
 * payload goes in instead and the signature comes back as `signature`; the
 * server puts it on the entry.
 */
export async function signAuthEntryWith(
  client: WalletSignClient,
  entryXdr: string,
  options: { validUntilLedger: number; payload?: string },
): Promise<AuthEntryResult> {
  const { payload, validUntilLedger } = options;
  try {
    if (payload && client.getWalletType?.() === FREIGHTER) {
      const signed = await client.signAuthEntry(payload, { validUntilLedger });
      return signed.status === 'signed' ? { status: 'signature', signature: signed.signedAuthEntry } : signed;
    }
    return await client.signAuthEntry(entryXdr, { validUntilLedger });
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
