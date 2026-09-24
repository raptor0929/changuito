'use client';

import { useEffect, useState } from 'react';

import type { FaucetAccess } from './faucet-proof.ts';

/**
 * Whether this wallet may use the test faucet, as the server sees it.
 *
 * Null until the answer arrives, and callers treat null as "no": a button
 * that appears and then vanishes is better than one a stranger gets to press.
 * One request per address per page load — the widget and the payment modal
 * both ask, and the answer does not change without a deploy.
 */
const cache = new Map<string, Promise<FaucetAccess | null>>();

function load(address: string): Promise<FaucetAccess | null> {
  let hit = cache.get(address);
  if (!hit) {
    hit = fetch(`/api/faucet?address=${encodeURIComponent(address)}`, { credentials: 'same-origin' })
      .then(async (res) => (res.ok ? ((await res.json()) as FaucetAccess) : null))
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

export function useFaucetAccess(address: string | null): FaucetAccess | null {
  const [access, setAccess] = useState<FaucetAccess | null>(null);
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
