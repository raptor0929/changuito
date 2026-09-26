import type { Cart } from '@changuito/mcp/types';

import { RETAILER_NAMES } from '../lib/retailers.ts';

/**
 * The basket as the store itself reports it, including its complaints.
 *
 * `messages` is where VTEX says a price moved or an item went out of stock
 * between search and cart. Hiding those would mean showing a total the user
 * is not going to be charged.
 */
export function CartCard({
  cart,
  handoffUrl,
  onPay,
}: {
  cart: Cart;
  handoffUrl?: string;
  onPay?: (cart: Cart) => void;
}) {
  const unavailable = cart.lines.filter((l) => !l.available);
  const store = RETAILER_NAMES[cart.retailer] ?? cart.retailer;
  return (
    <section className="cart" aria-label="Carrito">
      <header className="cart-head">
        <span className="cart-title">Tu changuito</span>
        <span className="cart-retailer">{store}</span>
      </header>

      <ul className="cart-lines">
        {cart.lines.map((l) => (
          <li key={l.index} className={l.available ? 'cart-line' : 'cart-line is-oos'}>
            <span className="cart-qty">{l.quantity}×</span>
            <span className="cart-name">{l.name}</span>
            <span className="cart-amount">{l.lineTotal.display}</span>
          </li>
        ))}
      </ul>

      {cart.messages.length > 0 ? (
        <ul className="cart-notes">
          {cart.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}

      <footer className="cart-foot">
        <div className="cart-total">
          <span>Total</span>
          <strong>{cart.total.display}</strong>
        </div>
        {unavailable.length > 0 ? (
          <p className="cart-warn">
            {unavailable.length === 1
              ? '1 producto quedó sin stock.'
              : `${unavailable.length} productos quedaron sin stock.`}
          </p>
        ) : null}
        <div className="cart-actions">
          {onPay ? (
            <button type="button" className="btn btn-pay" onClick={() => onPay(cart)}>
              Pagá con USDC
            </button>
          ) : null}
          {handoffUrl ? (
            <a className="btn btn-ghost" href={handoffUrl} target="_blank" rel="noopener noreferrer">
              Abrir en {store}
            </a>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
