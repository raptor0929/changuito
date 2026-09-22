'use client';

import { usePollar } from '@pollar/react';
import { useState } from 'react';

import { pollarEnabled, shortAddress } from '../lib/pollar.ts';
import { useBalances } from '../lib/use-balances.ts';

/**
 * The balance widget in the masthead.
 *
 * Two components rather than one with a conditional hook: `pollarEnabled` is a
 * build constant, so which of them mounts is decided once, and `usePollar()`
 * only ever runs inside a provider that exists.
 */
export function WalletWidget() {
  return pollarEnabled ? <ConnectedWallet /> : <NoWallet />;
}

function NoWallet() {
  return (
    <div className="wallet wallet-off" title="Falta NEXT_PUBLIC_POLLAR_API_KEY. Ver DEPLOY.md">
      <span className="wallet-label">Tu pago</span>
      <span className="wallet-muted">pago no configurado</span>
    </div>
  );
}

function ConnectedWallet() {
  const { wallet, isAuthenticated, verified, openLoginModal, logout } = usePollar();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data, loading, error, refresh } = useBalances(address);

  const [funding, setFunding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function fund() {
    if (!address) return;
    setFunding(true);
    setNote(null);
    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const json = await res.json();
      // 429 carries a real answer ("you already have enough"), not a failure.
      if (!res.ok && res.status !== 429) throw new Error(json.error ?? `faucet failed (${res.status})`);
      setNote(
        json.note ??
          (json.created
            ? 'Listo: saldo de prueba cargado.'
            : '+50,00 USDC de prueba.'),
      );
      refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setFunding(false);
    }
  }

  if (!address) {
    return (
      <div className="wallet">
        <button type="button" className="btn" onClick={openLoginModal}>
          Empezá a comprar
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-head">
        <span className="wallet-label">Tu pago</span>
        <button
          type="button"
          className="wallet-addr"
          onClick={() => void navigator.clipboard?.writeText(address)}
          title={`${address}. Clic para copiar`}
        >
          {shortAddress(address)}
        </button>
      </div>

      <div className="wallet-balance">
        <strong>{data ? data.usdcDisplay : '-'}</strong>
        <span className="wallet-unit">USDC</span>
        {loading && <span className="wallet-muted">actualizando…</span>}
      </div>

      <div className="wallet-sub">
        {/* Warn only when the account cannot pay network fees yet. */}
        {data && !data.funded && <span className="wallet-warn">falta saldo para comisiones</span>}
        {!verified && <span className="wallet-muted">verificando sesión…</span>}
      </div>

      {error && <p className="wallet-error">{error}</p>}
      {note && <p className="wallet-note">{note}</p>}

      <div className="wallet-actions">
        <button type="button" className="btn btn-sm" onClick={() => void fund()} disabled={funding}>
          {funding ? 'Cargando…' : 'Cargar USDC'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
          Actualizar
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            logout();
          }}
        >
          Salir
        </button>
      </div>
    </div>
  );
}
