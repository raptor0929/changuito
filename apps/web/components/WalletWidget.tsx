'use client';

import { usePollar } from '@pollar/react';

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
    <div className="wallet wallet-off" title="Falta NEXT_PUBLIC_POLLAR_API_KEY — ver DEPLOY.md">
      <span className="wallet-label">Billetera</span>
      <span className="wallet-muted">sin configurar</span>
    </div>
  );
}

function ConnectedWallet() {
  const { wallet, isAuthenticated, verified, openLoginModal, logout } = usePollar();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data, loading, error, refresh } = useBalances(address);

  if (!address) {
    return (
      <div className="wallet">
        <button type="button" className="btn" onClick={openLoginModal}>
          Conectar billetera
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-head">
        <span className="wallet-label">Billetera</span>
        <button
          type="button"
          className="wallet-addr"
          onClick={() => void navigator.clipboard?.writeText(address)}
          title={`${address} — clic para copiar`}
        >
          {shortAddress(address)}
        </button>
      </div>

      <div className="wallet-balance">
        <strong>{data ? data.usdcDisplay : '—'}</strong>
        <span className="wallet-unit">USDC de prueba</span>
        {loading && <span className="wallet-muted">actualizando…</span>}
      </div>

      <div className="wallet-sub">
        {/* XLM is not the point, but a wallet with none cannot sign anything,
            so it is worth a line rather than a surprise at payment time. */}
        {data?.xlm !== null && data?.xlm !== undefined && <span>{Number(data.xlm).toFixed(2)} XLM</span>}
        {data && !data.funded && <span className="wallet-warn">sin XLM para comisiones</span>}
        {!verified && <span className="wallet-muted">verificando sesión…</span>}
      </div>

      {error && <p className="wallet-error">{error}</p>}

      <div className="wallet-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
          Actualizar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Salir
        </button>
      </div>
    </div>
  );
}
