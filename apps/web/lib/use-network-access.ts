'use client';

import { useEffect, useState } from 'react';

import type { NetworkAccessMap } from '../app/api/network/route.ts';

/**
 * Which modes this wallet may use, as the server sees it.
 *
 * Null until the answer arrives, and callers treat null as "only the safe
 * one": an option that appears and then vanishes is worse than one that
 * arrives a moment late. Same module-scope cache as use-faucet-access.ts —
 * one request per address per page load, because the answer does not change
 * without a deploy.
 */
const cache = new Map<string, Promise<NetworkAccessMap | null>>();

function load(address: string): Promise<NetworkAccessMap | null> {
  let hit = cache.get(address);
  if (!hit) {
    hit = fetch(`/api/network?address=${encodeURIComponent(address)}`, { credentials: 'same-origin' })
      .then(async (res) => (res.ok ? ((await res.json()) as NetworkAccessMap) : null))
      .catch(() => null)
      .then((access) => {
        // A failed read is not an answer; the next mount may ask again.
        if (!access) cache.delete(address);
        return access;
      });
    cache.set(address, hit);
  }
  return hit;
}

export function useNetworkAccess(address: string | null): NetworkAccessMap | null {
  const [access, setAccess] = useState<NetworkAccessMap | null>(null);
  useEffect(() => {
    setAccess(null);
    if (!address) return;
    let live = true;
    void load(address).then((a) => {
      if (live) setAccess(a);
    });
    return () => {
      live = false;
    };
  }, [address]);
  return access;
}
