'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import { track, trackLoginStart } from '../lib/analytics';
import { pollarEnabled, shortAddress } from '../lib/pollar.ts';
import { ensureUserCookie, forgetUserCookie } from '../lib/session-login.ts';
import { faucetProofMessage, type FaucetProof } from '../lib/faucet-proof.ts';
import { useBalances } from '../lib/use-balances.ts';
import { useFaucetAccess } from '../lib/use-faucet-access.ts';
import { FaucetConfirm } from './FaucetConfirm';

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
  useEffect(() => {
    track('payment_view', { state: 'unconfigured' });
  }, []);
  return (
    <div className="wallet wallet-off" title="Falta NEXT_PUBLIC_POLLAR_API_KEY. Ver DEPLOY.md">
      <span className="wallet-label">Tu pago</span>
      <span className="wallet-muted">pago no configurado</span>
    </div>
  );
}

function ConnectedWallet() {
  const { wallet, isAuthenticated, verified, openLoginModal, logout, getClient } = usePollar();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data, loading, error, refresh } = useBalances(address);
  // Only testers on the server's allowlist get the faucet. Everyone else never
  // sees the button: the route would refuse them anyway.
  const faucet = useFaucetAccess(address);

  const [funding, setFunding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fundButton = useRef<HTMLButtonElement>(null);

  const closeConfirm = () => {
    setConfirming(false);
    // The dialog took focus from this button; keyboard users land back on it.
    requestAnimationFrame(() => fundButton.current?.focus());
  };

  // After Pollar login, set httpOnly chg_user so /api/chat skips the guest turn
  // limit. Shared with the chat, which awaits the same promise before it
  // re-sends a message the gate rejected — see lib/session-login.ts.
  const wasAuthed = useRef(isAuthenticated);
  useEffect(() => {
    if (!wasAuthed.current && isAuthenticated) track('login_success');
    wasAuthed.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!address) return;
    track('payment_view', { state: 'ready' });
  }, [address]);

  useEffect(() => {
    if (!isAuthenticated || !address) return;
    let cancelled = false;
    void ensureUserCookie(address).then((ok) => {
      if (!cancelled && !ok) track('login_fail', { code: 'session' });
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, address]);


  async function fund() {
    if (!address) return;
    track('payment_start', { flow: 'faucet' });
    setFunding(true);
    setNote(null);
    try {
      // The address is only a claim. The allowlist wants the wallet to sign
      // for it (SEP-53), which Pollar does only for a live session.
      let proof: FaucetProof | undefined;
      if (faucet?.mode === 'allowlist') {
        const message = faucetProofMessage(address, Date.now());
        const signed = await getClient().stellar.sep53.signMessage(message);
        if (signed.status !== 'signed') {
          throw new Error('No pudimos confirmar tu sesión para cargar USDC. Probá de nuevo.');
        }
        proof = { message, signature: signed.signature };
      }
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, proof }),
      });
      const json = await res.json();
      // 429 carries a real answer ("you already have enough"), not a failure.
      if (!res.ok && res.status !== 429) {
        throw new Error(json.message ?? json.error ?? `faucet failed (${res.status})`);
      }
      track('payment_success', { flow: 'faucet', code: res.status === 429 ? 'enough' : 'ok' });
      setNote(
        json.note ??
          (json.created
            ? 'Listo: saldo de prueba cargado.'
            : '+50,00 USDC de prueba.'),
      );
      refresh();
    } catch (err) {
      track('payment_fail', { flow: 'faucet', code: 'error' });
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setFunding(false);
    }
  }

  if (!address) {
    return (
      <div className="wallet">
        <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
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
        {faucet?.allowed ? (
          <button
            ref={fundButton}
            type="button"
            className="btn btn-sm"
            data-testid="wallet-fund"
            aria-haspopup="dialog"
            onClick={() => {
              setNote(null);
              setConfirming(true);
            }}
            disabled={funding || confirming}
          >
            {funding ? 'Cargando…' : 'Cargar USDC'}
          </button>
        ) : null}
        {/* No visible label: the name is aria-label, and the 44px box is the target. */}
        <button
          type="button"
          className="btn btn-ghost wallet-icon-btn"
          data-testid="wallet-refresh"
          onClick={refresh}
          disabled={loading}
          aria-label="Actualizar"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="btn btn-ghost wallet-icon-btn"
          data-testid="wallet-logout"
          aria-label="Salir"
          onClick={() => {
            track('logout');
            forgetUserCookie();
            void fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => logout());
          }}
        >
          <LogoutIcon />
        </button>
      </div>

      {confirming && faucet?.allowed ? (
        <FaucetConfirm
          balanceUnits={data ? BigInt(data.usdc) : null}
          onClose={closeConfirm}
          onConfirm={() => {
            closeConfirm();
            void fund();
          }}
        />
      ) : null}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
