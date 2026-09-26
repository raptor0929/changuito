'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useState } from 'react';

import type { OrderLine } from '../app/api/orders/route.ts';
import { track, trackLoginStart } from '../lib/analytics';
import {
  dollars,
  ORDER_STATUS,
  pesos,
  purchaseDate,
  PURCHASES,
} from '../lib/orders-copy.ts';
import { pollarEnabled } from '../lib/pollar.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof } from '../lib/wallet-proof.ts';
import { useNetwork } from './NetworkProvider';

/**
 * What this shopper has bought here, read from the record rather than the
 * browser.
 *
 * The chat keeps its own history in localStorage and the rail lists it, which
 * is enough right up until somebody shops on their phone and opens a laptop.
 * This page is the other half: `POST /api/orders` answers from Postgres, so it
 * is the same list on every device and it survives a cleared browser.
 *
 * ## Nothing loads on its own
 *
 * The read costs a wallet signature, and a signature is a modal in somebody's
 * wallet. Firing that on mount would mean a page that interrupts you for
 * permission before you have said what you came for — so the list is behind a
 * button, and the sentence above it says the signature is coming.
 *
 * ## Preview is not an empty list
 *
 * A signed-out visitor has no purchases *because nothing was written down*,
 * not because they never shopped — they may well have shopped, on our money,
 * five minutes ago. An empty list would quietly tell them the wrong thing, so
 * that state says what preview is and offers the crossing instead. Same words
 * as the masthead, which is deliberate: one crossing, one sentence.
 *
 * The provider split is WalletWidget's, for WalletWidget's reason:
 * `usePollar()` throws outside a provider, `pollarEnabled` is a build
 * constant, so the branch is fixed for the life of the bundle and hook order
 * cannot change under it.
 */
export function Purchases() {
  return pollarEnabled ? <WithWallet /> : <NoWallet />;
}

function NoWallet() {
  return (
    <section className="purchases">
      <h2 className="purchases-title">{PURCHASES.title}</h2>
      <p className="purchases-lead">Falta configurar el inicio de sesión en esta instalación.</p>
    </section>
  );
}

function WithWallet() {
  const { wallet, isAuthenticated, openLoginModal } = usePollar();
  const { network } = useNetwork();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;

  const [orders, setOrders] = useState<OrderLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Refusing the wallet prompt is a decision, not a fault, so it gets its
      // own sentence rather than the generic failure.
      const proof = await signWalletProof(sign, 'orders', address);
      if (!proof) {
        setError(PURCHASES.signRefused);
        return;
      }
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, network, proof }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // `message` first, then `error`: the route writes the code for the
        // logs in one and the sentence for a person in the other, and the
        // ones without a `message` are already sentences.
        const said =
          typeof body?.message === 'string'
            ? body.message
            : typeof body?.error === 'string'
              ? sentence(body.error)
              : null;
        setError(said ?? PURCHASES.error);
        return;
      }
      const list = Array.isArray(body?.orders) ? (body.orders as OrderLine[]) : [];
      setOrders(list);
      track('purchases_read', { count: String(list.length) });
    } catch {
      setError(PURCHASES.error);
    } finally {
      setLoading(false);
    }
  }, [address, loading, network, sign]);

  return (
    <section className="purchases" data-testid="purchases">
      <h2 className="purchases-title">{PURCHASES.title}</h2>

      {!address ? (
        <div className="purchases-empty" data-testid="purchases-guest">
          <h3 className="purchases-sub">{PURCHASES.guestTitle}</h3>
          <p className="purchases-lead">{PURCHASES.guestBody}</p>
          <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
            {PURCHASES.guestAction}
          </button>
        </div>
      ) : (
        <>
          <p className="purchases-lead">{PURCHASES.lead}</p>
          {orders === null ? (
            <div className="purchases-empty">
              <p className="purchases-lead">{PURCHASES.signLead}</p>
              <button
                type="button"
                className="btn"
                data-testid="purchases-load"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? PURCHASES.loading : PURCHASES.loadCta}
              </button>
            </div>
          ) : orders.length === 0 ? (
            <p className="purchases-lead" data-testid="purchases-none">
              {PURCHASES.empty}
            </p>
          ) : (
            <ul className="purchases-list" data-testid="purchases-list">
              {orders.map((o) => (
                <li className="purchase" key={`${o.network}:${o.memo}`}>
                  <div className="purchase-head">
                    {/* The pesos they read on screen, not the dollars that
                        were sent: the rate moves between the two, and the
                        figure a person remembers is the one they were shown. */}
                    <strong className="purchase-amount">
                      {o.arsQuoted === null ? dollars(o.amountCents) : pesos(o.arsQuoted)}
                    </strong>
                    <span className="purchase-status" data-status={o.status}>
                      {ORDER_STATUS[o.status]}
                    </span>
                  </div>
                  <p className="purchase-meta">
                    <span>{purchaseDate(o.createdAt)}</span>
                    <span className="purchase-code">
                      {PURCHASES.codeLabel} <code>{o.memo}</code>
                    </span>
                  </p>
                  {o.hasCard ? <p className="purchase-note">{PURCHASES.cardNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {error ? (
            <p className="pay-warn" role="status" data-testid="purchases-error">
              {error}
            </p>
          ) : null}
        </>
      )}

      <p className="purchases-back">
        <a href="/">{PURCHASES.back}</a>
      </p>
    </section>
  );
}

/** A fragment from an API turned into something that can sit in a paragraph. CardPanel has the same one. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const capped = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
