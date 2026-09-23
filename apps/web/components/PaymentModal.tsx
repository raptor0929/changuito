'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { track, trackLoginStart } from '../lib/analytics';
import type { QuoteResponse } from '../app/api/quote/route.ts';
import { DEPLOYMENTS } from '../lib/deployments.ts';
import { basketHash, newOrderId, openArgs, toHex, type OpenedOrder } from '../lib/order.ts';
import { pollarEnabled, shortAddress } from '../lib/pollar.ts';
import { useBalances } from '../lib/use-balances.ts';

/**
 * Step 4 of the flow: the last screen before money moves.
 *
 * It shows the basket, the peso total the store quoted, the USDC that converts
 * to, and the wallet's balance — and then asks. Everything the contract is
 * about to commit to is on this screen, because `basket_hash` is only a
 * meaningful promise if the user saw the basket it hashes.
 */
export function PaymentModal(props: Props) {
  // Same split as WalletWidget: `pollarEnabled` is a build constant, so
  // `usePollar()` never runs outside a provider that exists.
  return pollarEnabled ? <PayWithPollar {...props} /> : null;
}

interface Props {
  cart: Cart;
  handoffUrl?: string;
  onClose: () => void;
  onOpened: (order: OpenedOrder) => void;
}

type Phase = 'review' | 'signing' | 'failed';

function PayWithPollar({ cart, handoffUrl, onClose, onOpened }: Props) {
  const { wallet, isAuthenticated, verified, openLoginModal, runTx } = usePollar();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data: balance, refresh } = useBalances(address);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('review');
  const [failure, setFailure] = useState<string | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quote?centavos=${cart.total.centavos}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? `quote failed (${res.status})`);
        setQuote(json as QuoteResponse);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        track('payment_fail', { flow: 'checkout', code: 'quote' });
        setQuoteError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cart.total.centavos]);

  // Escape closes — but not mid-signature, where closing would leave the user
  // unsure whether their money moved.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'signing') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  useEffect(() => {
    confirm.current?.focus();
  }, [quote]);

  const amountUnits = quote ? BigInt(quote.units) : 0n;
  const held = balance ? BigInt(balance.usdc) : 0n;
  // Only a balance we actually read can be short. Without a wallet the balance
  // is unknown, not zero, and "no te alcanza" would be a lie under a button
  // that says "Empezá a comprar".
  const short = balance !== null && quote !== null && held < amountUnits;

  async function pay() {
    if (!address || !quote) return;
    setPhase('signing');
    setFailure(null);
    try {
      const orderId = newOrderId();
      const basket = await basketHash(cart);
      const outcome = await runTx('invoke_contract', {
        contractId: DEPLOYMENTS.escrowId,
        method: 'open',
        args: openArgs({ buyer: address, orderId, amountUnits, basketHash: basket }),
      });

      if (outcome.status === 'error') {
        // resultCode is the ledger's own verdict and the only part worth
        // pasting into a search; message is for the human.
        throw new Error(
          outcome.message ??
            outcome.details ??
            outcome.resultCode ??
            'la red rechazó la transacción',
        );
      }

      track('payment_success', { flow: 'checkout' });
      refresh();
      // The modal's job ends here. What comes next — finishing the basket at
      // the store, then settling — happens on the page, not behind a dialog.
      onOpened({
        orderId: toHex(orderId),
        basketHash: toHex(basket),
        amountUnits: amountUnits.toString(),
        hash: outcome.hash,
        retailer: cart.retailer,
        cartId: cart.cartId,
        totalDisplay: cart.total.display,
        handoffUrl,
      });
      onClose();
    } catch (err) {
      track('payment_fail', { flow: 'checkout', code: 'rejected' });
      setFailure(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => phase !== 'signing' && onClose()}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar el pago"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Confirmar y pagar</h2>
          <button
            type="button"
            className="modal-x"
            onClick={onClose}
            disabled={phase === 'signing'}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <ul className="pay-lines">
          {cart.lines
            .filter((l) => l.available)
            .map((l) => (
              <li key={l.index}>
                <span className="cart-qty">{l.quantity}×</span>
                <span>{l.name}</span>
                <span className="cart-amount">{l.lineTotal.display}</span>
              </li>
            ))}
        </ul>

        <dl className="pay-rows">
          <div>
            <dt>Total en el super</dt>
            <dd>{cart.total.display}</dd>
          </div>
          <div className="pay-total">
            <dt>A pagar</dt>
            <dd>{quote ? `${quote.display} USDC` : quoteError ? '-' : 'cotizando…'}</dd>
          </div>
          {quote ? (
            <div className="pay-fine">
              <dt>Tipo de cambio</dt>
              <dd>{quote.arsPerUsd.toFixed(2)} ARS/USD</dd>
            </div>
          ) : null}
          <div className="pay-fine">
            <dt>Tu saldo</dt>
            <dd>{balance ? `${balance.usdcDisplay} USDC` : '-'}</dd>
          </div>
        </dl>

        {quoteError ? <p className="pay-error">{quoteError}</p> : null}
        {failure ? <p className="pay-error">{failure}</p> : null}
        {short ? (
          <p className="pay-warn">
            No te alcanza el saldo. Cargá USDC arriba y volvé a intentar.
          </p>
        ) : null}
        {address && balance && !balance.funded ? (
          <p className="pay-warn">Te falta saldo para la comisión de la red. Usá “Cargar USDC”.</p>
        ) : null}

        <p className="pay-note">
          El monto queda reservado hasta que completes la compra en el súper. Si no se concreta,
          vuelve a tu saldo. Pagá con tarjeta o USDC.
        </p>

        <div className="modal-actions">
          {!address ? (
            <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
              Empezá a comprar
            </button>
          ) : (
            <button
              ref={confirm}
              type="button"
              className="btn"
              onClick={() => void pay()}
              disabled={!quote || !verified || short || phase === 'signing'}
            >
              {phase === 'signing'
                ? 'Confirmando…'
                : !verified
                  ? 'Verificando sesión…'
                  : `Pagar ${quote ? quote.display : ''} USDC`}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={phase === 'signing'}
          >
            Cancelar
          </button>
        </div>

        {address ? (
          <p className="pay-fine-line">Desde {shortAddress(address)}</p>
        ) : null}
      </section>
    </div>
  );
}
