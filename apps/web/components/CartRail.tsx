'use client';

import type { Cart } from '@changuito/mcp/types';

import { RETAILER_NAMES } from '../lib/retailers.ts';
import { useShop } from './ShopProvider';

/**
 * The basket, always on screen, on a wide window.
 *
 * It is a second view of the same data the CartCard in the thread shows, not
 * a second cart. The card is the record of what the basket was when the agent
 * reported it and stays where it was said; this is what it is *now*. On a
 * narrow window there is no room for both, and the card already scrolls into
 * view on its own, so the rail is wide-only — see globals.css.
 *
 * The mascot sits in the top-right corner, overlapping the panel's border.
 * `mascota-lleno` is the full-changuito pose and it has been in the brand
 * folder unused since the first drop.
 */
export function CartRail() {
  const shop = useShop();
  const cart = shop?.cart ?? null;
  return (
    <aside className="rail rail-cart" aria-label="Tu changuito">
      <div className="rail-cart-panel">
        <img
          className="rail-mascot"
          src="/brand/mascota-lleno.png"
          alt=""
          aria-hidden="true"
          width={419}
          height={609}
        />
        <header className="rail-cart-head">
          <span className="rail-cart-title">Tu changuito</span>
          {cart ? <span className="rail-cart-store">{RETAILER_NAMES[cart.retailer] ?? cart.retailer}</span> : null}
        </header>
        {cart && cart.lines.length > 0 ? <RailLines cart={cart} /> : <EmptyRail />}
      </div>
    </aside>
  );
}

function EmptyRail() {
  return (
    <p className="rail-cart-empty">
      Todavía no hay nada acá. Contale a Changuito qué necesitás y lo va llenando.
    </p>
  );
}

function RailLines({ cart }: { cart: Cart }) {
  const unavailable = cart.lines.filter((l) => !l.available).length;
  return (
    <>
      {/* The list is the scroller, not the panel: the total has to stay on
          screen under a long basket, the same way the composer does under a
          long thread. */}
      <ul className="rail-cart-lines">
        {cart.lines.map((l) => (
          <li key={l.index} className={l.available ? 'rail-cart-line' : 'rail-cart-line is-oos'}>
            <span className="rail-cart-qty">{l.quantity}×</span>
            <span className="rail-cart-name">{l.name}</span>
            <span className="rail-cart-amount">{l.lineTotal.display}</span>
          </li>
        ))}
      </ul>
      <footer className="rail-cart-foot">
        {unavailable > 0 ? (
          <p className="rail-cart-warn">
            {unavailable === 1 ? '1 producto sin stock.' : `${unavailable} productos sin stock.`}
          </p>
        ) : null}
        <div className="rail-cart-total">
          <span>Total</span>
          <strong>{cart.total.display}</strong>
        </div>
      </footer>
    </>
  );
}
