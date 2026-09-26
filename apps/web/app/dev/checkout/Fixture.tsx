'use client';

import { useState } from 'react';

/**
 * The client half, so the buttons do something. Deliberately plain: this is a
 * stand-in, and making it look convincingly like Día would only make it easier
 * to mistake a screenshot of the rehearsal for a screenshot of a purchase.
 */
export function Fixture({ retailer, total }: { retailer: string; total: string }) {
  const [step, setStep] = useState<'cart' | 'paid'>('cart');

  return (
    <main className="dev-checkout">
      <p className="dev-checkout-badge">Página de prueba. No es el súper y no cobra nada.</p>
      <h1>{retailer}</h1>
      <p className="dev-checkout-total">Total: {total}</p>

      {step === 'cart' ? (
        <button
          type="button"
          className="btn"
          data-testid="fixture-pay"
          onClick={() => setStep('paid')}
        >
          Pagar
        </button>
      ) : (
        <p className="dev-checkout-done" role="status" data-testid="fixture-paid">
          Listo. Volvé a la ventana anterior y tocá “Ya lo pagué”.
        </p>
      )}
    </main>
  );
}
