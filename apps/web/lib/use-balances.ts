'use client';

import { useCallback, useEffect, useState } from 'react';

import type { BalanceResponse } from '../app/api/balance/route.ts';
import { DEFAULT_NETWORK, type NetworkId } from './deployments.ts';
import { SOLO_HUMANOS } from './human-gate-ui';
import { BALANCE } from './mode-copy.ts';

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
 *
 * Keyed on the network as well as the address, because the same wallet holds
 * different money on each chain. It is in the dep array, which is the whole
 * fix: flipping the mode drops the old number and refetches rather than
 * leaving one chain's balance on screen under the other one's label.
 *
 * ## Only ever called with mainnet now
 *
 * `address` comes from the connected wallet, and since lib/app-mode.ts the
 * only way to have one is to be signed in, which is production, which is
 * mainnet. So the testnet arm of this is unreachable from the app: preview
 * shows no balance at all, because the money on screen would be ours.
 *
 * The `network` parameter stays. Removing it would hardcode a chain into a
 * hook that has no opinion about chains, and the arm costs nothing — it is
 * one fetch with a different query string. If a second Pollar key ever
 * returns, this is one of the few places that needs no change.
 *
 * ## `error` is copy, never a message from somewhere else
 *
 * It is rendered verbatim beside the balance, so everything that reaches it
 * has to be written for a shopper. It was not: the hook parsed the body
 * before looking at the status, threw whatever the server or the JSON parser
 * said, and painted that. A route's own 502 put `could not read balances:
 * Invalid contract ID:` on screen; a gateway's HTML error page put
 * `Unexpected token '<', "<!DOCTYPE "…` there, which is what a signed-in
 * shopper actually saw.
 *
 * Both are now one Spanish line, and the detail goes to the console, where
 * whoever is debugging can find it and nobody else has to read it.
 */
export function useBalances(address: string | null, network: NetworkId = DEFAULT_NETWORK): Balances {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Its own effect, before the fetch, so it does *not* run on `refresh()`.
  // A wallet that just funded should watch its number change, not blink to
  // empty; a wallet that changed network is showing a number that is now
  // simply wrong, and the wrong number must go before the request, not when
  // the answer lands.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [address, network]);

  useEffect(() => {
    if (!address) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`)
      .then(async (res) => {
        // Status first, body second. A lambda that crashed or a gateway that
        // timed out answers with an HTML error page, and parsing that throws
        // before there is anything to check — which is how the parser's own
        // complaint ended up being the error the shopper read.
        const json = (await res.json().catch(() => null)) as
          | (Partial<BalanceResponse> & { error?: string; message?: string })
          | null;
        if (cancelled) return;
        if (!res.ok || !json) {
          // The human gate already explains this. The raw code `solo_humanos`
          // was showing up in red inside the wallet.
          if (json?.error === SOLO_HUMANOS) {
            setData(null);
            setError(null);
            return;
          }
          console.warn('[balance] read failed:', res.status, json?.error ?? json?.message ?? '(unparseable body)');
          setData(null);
          setError(BALANCE.unavailable);
          return;
        }
        setData(json as BalanceResponse);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The browser's own text is English and names nothing anybody can act
        // on, so it goes to the console and the shopper gets the same line as
        // every other way this read can fail.
        console.warn('[balance] request failed:', err);
        setData(null);
        setError(BALANCE.unavailable);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // A logout mid-flight must not write the old wallet's balance into the new
    // wallet's widget.
    return () => {
      cancelled = true;
    };
  }, [address, network, nonce]);

  return { data, loading, error, refresh };
}
