'use client';

import { useCallback, useEffect, useState } from 'react';

import type { BalanceResponse } from '../app/api/balance/route.ts';

export interface Balances {
  data: BalanceResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Polls nothing. Balances change when the user does something — funding, or
 * paying — and both of those call `refresh()` themselves. A timer here would
 * spend requests to tell the user the same number forty times.
 */
export function useBalances(address: string | null): Balances {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/balance?address=${encodeURIComponent(address)}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? `balance read failed (${res.status})`);
        setData(json as BalanceResponse);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // A logout mid-flight must not write the old wallet's balance into the new
    // wallet's widget.
    return () => {
      cancelled = true;
    };
  }, [address, nonce]);

  return { data, loading, error, refresh };
}
