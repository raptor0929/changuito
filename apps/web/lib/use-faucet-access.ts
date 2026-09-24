'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_NETWORK, type NetworkId } from './deployments.ts';
import type { FaucetAccess } from './faucet-proof.ts';

/**
 * Whether this wallet may use the test faucet, as the server sees it.
 *
 * Null until the answer arrives, and callers treat null as "no": a button
 * that appears and then vanishes is better than one a stranger gets to press.
 * One request per address per network per page load — the widget and the
 * payment modal both ask, and the answer does not change without a deploy.
 *
 * The cache key carries the network because the answer differs by chain: there
 * is no faucet where there is no friendbot. Keyed on the address alone, a flip
 * would keep showing the fund button from the other mode.
 */
const cache = new Map<string, Promise<FaucetAccess | null>>();

function load(address: string, network: NetworkId): Promise<FaucetAccess | null> {
  const key = `${network}:${address}`;
  let hit = cache.get(key);
  if (!hit) {
    const url = `/api/faucet?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`;
    hit = fetch(url, { credentials: 'same-origin' })
      .then(async (res) => (res.ok ? ((await res.json()) as FaucetAccess) : null))
      .catch(() => null)
      .then((access) => {
        // A failed read is not an answer; the next mount may ask again.
        if (!access) cache.delete(key);
        return access;
      });
    cache.set(key, hit);
  }
  return hit;
}

export function useFaucetAccess(address: string | null, network: NetworkId = DEFAULT_NETWORK): FaucetAccess | null {
  const [access, setAccess] = useState<FaucetAccess | null>(null);
  useEffect(() => {
    setAccess(null);
    if (!address) return;
    let live = true;
    void load(address, network).then((a) => {
      if (live) setAccess(a);
    });
    return () => {
      live = false;
    };
  }, [address, network]);
  return access;
}
