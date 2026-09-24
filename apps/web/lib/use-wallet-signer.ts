'use client';

import { usePollar } from '@pollar/react';
import { useCallback } from 'react';

import type { WalletSigner } from './wallet-proof.ts';

/**
 * SEP-53 signing with the Pollar wallet, as a stable function.
 *
 * Only for components that already sit inside PollarProvider. Custodial
 * wallets are signed by Pollar's backend for the live session; external ones
 * prompt their owner; passkey smart wallets cannot and resolve null.
 */
export function useWalletSigner(): WalletSigner {
  const { getClient } = usePollar();
  return useCallback(
    async (message: string) => {
      const signed = await getClient().stellar.sep53.signMessage(message);
      return signed.status === 'signed' ? signed.signature : null;
    },
    [getClient],
  );
}
