/**
 * Prepare / submit helpers for classic sponsored reserves.
 *
 * Kept out of the route so the transaction shape and the already-sponsored
 * no-op can be tested without loading Next, Horizon or the sponsor secret.
 */
import type { Keypair, Transaction } from '@stellar/stellar-sdk';

import { DEPLOYMENTS, type NetworkId } from './deployments.ts';
import {
  assertSponsoredEnvelope,
  buildSponsorTransaction,
  sponsorNeed,
  type SponsorNeed,
  SponsorTxError,
} from './sponsor-reserves.ts';
import { accountBalances, type AccountBalance } from './stellar.ts';

export type HorizonAccount = {
  sequence: string;
};

export interface SponsorFlowDeps {
  loadBalances: (address: string, network: NetworkId) => Promise<AccountBalance[] | null>;
  loadAccount: (address: string, network: NetworkId) => Promise<HorizonAccount>;
  submitTransaction: (tx: Transaction, network: NetworkId) => Promise<{ hash: string }>;
  sponsor: Keypair;
}

export type PrepareResult =
  | { status: 'ready'; need: 'ready' }
  | { status: 'sign'; need: Exclude<SponsorNeed, 'ready'>; xdr: string; networkPassphrase: string; sponsor: string };

export async function prepareSponsorship(
  user: string,
  network: NetworkId,
  deps: SponsorFlowDeps,
): Promise<PrepareResult> {
  const balances = await deps.loadBalances(user, network);
  const need = sponsorNeed(balances);
  if (need === 'ready') return { status: 'ready', need };

  const sponsorAccount = await deps.loadAccount(deps.sponsor.publicKey(), network);
  const tx = buildSponsorTransaction(
    {
      sponsorPublicKey: deps.sponsor.publicKey(),
      sponsorSequence: sponsorAccount.sequence,
      userPublicKey: user,
      need,
      network,
    },
    deps.sponsor,
  );
  return {
    status: 'sign',
    need,
    xdr: tx.toXDR(),
    networkPassphrase: DEPLOYMENTS[network].networkPassphrase,
    sponsor: deps.sponsor.publicKey(),
  };
}

export async function submitSponsorship(
  user: string,
  network: NetworkId,
  signedXdr: string,
  deps: SponsorFlowDeps,
): Promise<{ hash: string; need: Exclude<SponsorNeed, 'ready'> } | { status: 'ready' }> {
  const balances = await deps.loadBalances(user, network);
  const need = sponsorNeed(balances);
  if (need === 'ready') return { status: 'ready' };

  const tx = assertSponsoredEnvelope({
    xdr: signedXdr,
    network,
    sponsorPublicKey: deps.sponsor.publicKey(),
    userPublicKey: user,
    need,
  });
  const sent = await deps.submitTransaction(tx, network);
  return { hash: sent.hash, need };
}

/** Live Horizon wiring. Tests pass stubs instead. */
export function liveSponsorDeps(sponsor: Keypair): SponsorFlowDeps {
  return {
    sponsor,
    loadBalances: (address, network) => accountBalances(address, network),
    loadAccount: async (address, network) => {
      const res = await fetch(`${DEPLOYMENTS[network].horizonUrl}/accounts/${encodeURIComponent(address)}`);
      if (!res.ok) {
        throw new SponsorTxError(502, 'sponsor_horizon', 'No pudimos leer la cuenta sponsor.');
      }
      const json = (await res.json()) as { sequence?: string };
      if (!json.sequence) {
        throw new SponsorTxError(502, 'sponsor_horizon', 'No pudimos leer la cuenta sponsor.');
      }
      return { sequence: json.sequence };
    },
    submitTransaction: async (tx, network) => {
      const res = await fetch(`${DEPLOYMENTS[network].horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(tx.toXDR())}`,
      });
      const json = (await res.json().catch(() => null)) as { hash?: string; title?: string; detail?: string } | null;
      if (!res.ok || !json?.hash) {
        const detail = json?.detail ?? json?.title ?? `horizon ${res.status}`;
        throw new SponsorTxError(502, 'sponsor_submit', `No pudimos enviar el sponsorship: ${detail}`);
      }
      return { hash: json.hash };
    },
  };
}

export { SponsorTxError };
