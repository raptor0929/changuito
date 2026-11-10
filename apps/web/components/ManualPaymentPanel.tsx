'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StatusResponse } from '../lib/checkout/types.ts';
import { fetchAs } from '../lib/fetch-as.ts';
import { useWallet } from '../lib/use-wallet.ts';
import { useLang } from './LangProvider';

export function ManualPaymentPanel({ orderId, status, onUpdate }: {
  orderId: string; status: StatusResponse | null; onUpdate: (next: StatusResponse) => void;
}) {
  const lang = useLang();
  const en = lang === 'en';
  const wallet = useWallet();
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef<{ jobId: string; ticket: string; cardToken: string; lang: 'en' | 'es' } | null>(null);
  const viewerOrigin = useRef('');
  const loaded = useRef(false);
  const connecting = useRef(false);
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const m = status?.manual;
  const remaining = Math.max(0, Math.ceil(((m?.viewerExpiresAt ?? 0) - now) / 1000));
  const active = Boolean(m?.sessionActive && remaining > 0);
  const feeLabels: Record<string, string> = en ? {
    escrowed: 'Held in escrow', settlement_pending: 'Release pending', settled: 'Charged for preparation',
    refund_pending: 'Refund pending', refunded: 'Refunded',
  } : { escrowed: 'En escrow', settlement_pending: 'Liberación pendiente', settled: 'Cobrada por preparación',
    refund_pending: 'Devolución pendiente', refunded: 'Devuelta' };
  const purchaseLabels: Record<string, string> = en ? {
    not_started: 'Not submitted', in_progress: 'Submitted; awaiting confirmation', verification_required: 'Complete verification in DIA',
    placed: 'DIA order created', declined: 'Payment declined', unknown: 'Outcome unconfirmed', abandoned: 'Not completed',
  } : { not_started: 'Sin enviar', in_progress: 'Enviada; esperando confirmación', verification_required: 'Completá la verificación en DIA',
    placed: 'Pedido creado en DIA', declined: 'Pago rechazado', unknown: 'Resultado sin confirmar', abandoned: 'Sin completar' };
  const preparationLabels: Record<string, string> = en ? {
    queued: 'Waiting', preparing: 'Preparing', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', ready: 'Ready',
  } : { queued: 'En espera', preparing: 'Preparando', failed: 'Falló', cancelled: 'Cancelada', interrupted: 'Interrumpida', ready: 'Lista' };

  const request = useCallback(async (path: string) => {
    const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, `/api/checkout/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? (en ? 'Unable to connect.' : 'No pudimos conectar.'));
    return result;
  }, [wallet.address, wallet.accessToken, orderId, en]);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    setError('');
    try {
      const result = await request('viewer');
      const url = new URL(result.viewerUrl);
      viewerOrigin.current = url.origin;
      pending.current = {
        jobId: result.jobId, ticket: result.ticket, cardToken: result.cardToken ?? '', lang: en ? 'en' : 'es',
      };
      if (loaded.current && frame.current) {
        frame.current.contentWindow?.postMessage({ type: 'changuito-viewer-connect', ...pending.current }, url.origin);
        pending.current = null;
      } else setSrc(url.toString());
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection failed'); }
    finally { connecting.current = false; }
  }, [request]);

  useEffect(() => {
    function message(event: MessageEvent) {
      if (event.origin !== viewerOrigin.current || event.source !== frame.current?.contentWindow
          || event.data?.type !== 'changuito-viewer-ready') return;
      loaded.current = true;
      if (pending.current) {
        frame.current?.contentWindow?.postMessage({ type: 'changuito-viewer-connect', ...pending.current }, event.origin);
        pending.current = null;
      } else void connect();
    }
    window.addEventListener('message', message);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener('message', message); window.clearInterval(timer); pending.current = null; };
  }, [connect]);

  async function action(path: 'cancel' | 'start') {
    try { setError(''); onUpdate(await request(path)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
  }

  return <div className="ck-pay" data-testid="manual-payment-panel">
    <h3>{en ? 'Pay DIA in your prepared browser' : 'Pagá en DIA desde tu navegador preparado'}</h3>
    <p className="ck-note">
      {m?.preparedAt
        ? en ? 'Checkout preparation earned the 0.10 test USDC fee. DIA payment is separate; abandoning or a declined payment does not refund this fee.'
          : 'La preparación generó la comisión de 0,10 USDC de prueba. El pago en DIA es aparte; abandonar o un pago rechazado no devuelve esta comisión.'
        : en ? 'Preparing your account, basket and delivery. The fee is refunded if preparation fails.'
          : 'Estamos preparando tu cuenta, carrito y envío. Si la preparación falla, devolvemos la comisión.'}
    </p>
    <p role="status">{en ? 'Service fee' : 'Comisión'}: {feeLabels[status?.feeStatus ?? 'escrowed']}</p>
    <p role="status">{en ? 'DIA purchase' : 'Compra en DIA'}: {purchaseLabels[m?.purchase ?? 'not_started']}</p>
    {status?.storeOrderId ? <p>{en ? 'DIA order' : 'Pedido DIA'}: {status.storeOrderId}</p> : null}
    {active ? <>
      <p aria-live="off">{en ? 'Session remaining' : 'Tiempo restante'}: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>
      <p className="ck-note">{en ? 'Enter your card in the form. Then review the amount and complete any verification in the DIA session.'
        : 'Ingresá tu tarjeta en el formulario. Después revisá el importe y completá la verificación en la sesión de Día.'}</p>
      <button type="button" className="btn" onClick={() => void connect()}>{en ? 'Open / reconnect browser' : 'Abrir / reconectar navegador'}</button>
      {src ? <iframe ref={frame} src={src} title={en ? 'Your prepared DIA payment session' : 'Tu sesión de pago preparada en DIA'}
        style={{ width: '100%', height: 'min(70dvh, 760px)', minHeight: 380, border: '1px solid var(--border, #64748b)' }}
        referrerPolicy="origin" sandbox="allow-scripts allow-same-origin" /> : null}
    </> : m?.preparedAt ? <p>{en ? 'The browser session has ended. A pending or unknown purchase is not proof of payment; check your DIA account before trying again.'
      : 'La sesión del navegador terminó. Una compra pendiente o sin confirmar no prueba el pago; revisá tu cuenta de DIA antes de reintentar.'}</p>
      : <p>{en ? 'Preparation' : 'Preparación'}: {preparationLabels[m?.preparation ?? 'queued']}</p>}
    {!m?.preparedAt && m?.preparation === 'queued'
      ? <button type="button" className="btn btn-ghost" onClick={() => void action('start')}>{en ? 'Retry preparation' : 'Reintentar preparación'}</button> : null}
    {(active || !m?.preparedAt) && status?.feeStatus !== 'refunded'
      ? <button type="button" className="btn btn-ghost" onClick={() => void action('cancel')}>
        {m?.preparedAt ? en ? 'Close browser session' : 'Cerrar sesión del navegador' : en ? 'Cancel preparation' : 'Cancelar preparación'}
      </button> : null}
    {error ? <p role="alert" className="pay-error">{error}</p> : null}
  </div>;
}
