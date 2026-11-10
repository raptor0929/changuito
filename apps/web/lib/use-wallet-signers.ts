'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useMemo } from 'react';

import {
  signAuthEntryWith,
  signTransactionWith,
  type AuthEntryResult,
  type TxSignResult,
  type WalletSignClient,
} from './wallet-signers.ts';

export type { AuthEntryResult, TxSignResult };

/**
 * Auth-entry and transaction signing through the Pollar wallet.
 *
 * Same shape as `useWalletSigner`: only for components inside PollarProvider.
 * Passkey smart wallets cannot sign an auth entry in this SDK build; Freighter
 * and other external wallets can. Both functions return a result — they never
 * throw on a user rejection.
 */
export function useWalletSigners(): {
  signAuthEntry: (
    entryXdr: string,
    options: { validUntilLedger: number; payload?: string },
  ) => Promise<AuthEntryResult>;
  signTransaction: (xdr: string) => Promise<TxSignResult>;
} {
  const { getClient } = usePollar();

  const client = useCallback((): WalletSignClient => getClient(), [getClient]);

  const signAuthEntry = useCallback(
    (entryXdr: string, options: { validUntilLedger: number; payload?: string }) =>
      signAuthEntryWith(client(), entryXdr, options),
    [client],
  );

  const signTransaction = useCallback(
    (xdr: string) => signTransactionWith(client(), xdr),
    [client],
  );

  return useMemo(
    () => ({ signAuthEntry, signTransaction }),
    [signAuthEntry, signTransaction],
  );
}
