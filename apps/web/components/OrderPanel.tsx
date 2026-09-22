'use client';

import { useState } from 'react';

import type { SettleResponse } from '../app/api/settle/route.ts';
import type { OpenedOrder, SettleAction } from '../lib/order.ts';
import { explorer, formatUsdc } from '../lib/stellar.ts';

/**
 * Steps 5 and 6: the money is locked, and this is what closes it out.
 *
 * It sits below the thread rather than in a modal on purpose — the user has to
 * leave the page to finish the basket at the store, and a dialog they must
 * dismiss to do that is a dialog they will dismiss and then not find again.
 */
// onDismiss is optional: a server-rendered page cannot pass a function prop,
// and the fixtures page mounts this panel without one.
export function OrderPanel({ order, onDismiss }: { order: OpenedOrder; onDismiss?: () => void }) {
  const [closing, setClosing] = useState<SettleAction | null>(null);
  const [outcome, setOutcome] = useState<SettleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = formatUsdc(BigInt(order.amountUnits));

  async function close(action: SettleAction) {
    setClosing(action);
    setError(null);
    try {
      const res = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          orderId: order.orderId,
          basketHash: order.basketHash,
          retailer: order.retailer,
          cartId: order.cartId,
          handoffUrl: order.handoffUrl,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `settle failed (${res.status})`);
      setOutcome(json as SettleResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(null);
    }
  }

  if (outcome) {
    const settled = outcome.action === 'settle';
    return (
      <section className={settled ? 'order-panel is-done' : 'order-panel'} aria-live="polite">
        <header className="order-head">
          <strong>{settled ? '✓ Tu changuito está pago' : 'Orden reembolsada'}</strong>
          {onDismiss ? (
            <button type="button" className="modal-x" onClick={onDismiss} aria-label="Cerrar">
              ×
            </button>
          ) : null}
        </header>
        <p className="pay-note">
          {settled
            ? `${outcome.amountDisplay} USDC quedaron confirmados. Retirá el pedido en el súper.`
            : `${outcome.amountDisplay} USDC volvieron a tu saldo. No se cobró nada.`}
        </p>
        <ul className="tx-list">
          <li>
            <span>Reserva</span>
            <a href={explorer.tx(order.hash)} target="_blank" rel="noopener noreferrer">
              ver transacción ↗
            </a>
          </li>
          <li>
            <span>{settled ? 'Confirmación' : 'Reembolso'}</span>
            <a href={outcome.txUrl} target="_blank" rel="noopener noreferrer">
              ver transacción ↗
            </a>
          </li>
        </ul>
        {outcome.receipt ? (
          // The preimage, not just the hash: 32 bytes on a block explorer prove
          // nothing unless you can see what was hashed into them.
          <details className="receipt">
            <summary>Comprobante del pago</summary>
            <pre>{outcome.receipt}</pre>
            <p className="pay-fine-line">sha256 = {outcome.receiptHash}</p>
          </details>
        ) : null}
        {settled && order.handoffUrl ? (
          <a className="btn" href={order.handoffUrl} target="_blank" rel="noopener noreferrer">
            Abrir el carrito
          </a>
        ) : null}
      </section>
    );
  }

  return (
    <section className="order-panel" aria-live="polite">
      <header className="order-head">
        <strong>Pago reservado · {amount} USDC</strong>
        <a href={explorer.tx(order.hash)} target="_blank" rel="noopener noreferrer">
          ver transacción ↗
        </a>
      </header>
      <p className="pay-note">
        Tu pago quedó reservado. Completá el carrito de {order.totalDisplay} en el súper y volvé
        acá para confirmarlo, o pedí el reembolso si no se pudo.
      </p>
      {error ? <p className="pay-error">{error}</p> : null}
      <div className="modal-actions">
        {order.handoffUrl ? (
          <a
            className="btn btn-ghost"
            href={order.handoffUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir el carrito
          </a>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => void close('settle')}
          disabled={closing !== null}
        >
          {closing === 'settle' ? 'Confirmando…' : 'Ya lo completé'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void close('refund')}
          disabled={closing !== null}
        >
          {closing === 'refund' ? 'Reembolsando…' : 'No se pudo'}
        </button>
      </div>
    </section>
  );
}
