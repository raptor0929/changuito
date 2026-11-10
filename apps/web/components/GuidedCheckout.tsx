'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { escrowCopy } from '../lib/checkout/copy.ts';
import { announcedPhase, flowCopy, flowScreen, type SteppedFlow } from '../lib/checkout/flow.ts';
import type { StatusResponse } from '../lib/checkout/types.ts';
import { fetchAs } from '../lib/fetch-as.ts';
import { useWallet } from '../lib/use-wallet.ts';
import frameStyles from './checkout-card-frame.module.css';
import { useLang } from './LangProvider';

/**
 * One task on screen at a time: progress, then the card form, then either
 * the Día session (guided) or a paying line (headless). The card iframe is
 * the sandbox form, not the store page, and it never shares the screen with
 * the remote browser.
 */
export function GuidedCheckout({ orderId, flow, status, pesos, cardSent, onUpdate, onCard }: {
  orderId: string;
  flow: SteppedFlow;
  status: StatusResponse | null;
  pesos: string;
  cardSent: boolean;
  onUpdate: (next: StatusResponse) => void;
  onCard: () => void;
}) {
  const lang = useLang();
  const locale = lang === 'en' ? 'en' : 'es';
  const words = flowCopy(locale);
  const phases = escrowCopy(locale).phases;
  const wallet = useWallet();
  const frame = useRef<HTMLIFrameElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<Record<string, string> | null>(null);
  const viewerOrigin = useRef('');
  const generation = useRef(0);
  const onCardRef = useRef(onCard);
  const flowRef = useRef(flow);
  onCardRef.current = onCard;
  flowRef.current = flow;
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [shownPhase, setShownPhase] = useState(status?.phase ?? 'queued');
  const [cardReady, setCardReady] = useState(false);
  const screen = flowScreen(flow, status, cardSent);
  const m = status?.manual;
  const remaining = Math.max(0, Math.ceil(((m?.viewerExpiresAt ?? 0) - now) / 1000));
  const active = Boolean(m?.sessionActive && remaining > 0);
  const phaseName = status?.phase ?? 'queued';

  useEffect(() => {
    setShownPhase((current) => announcedPhase(current, phaseName) ?? current);
  }, [phaseName]);

  useEffect(() => {
    heading.current?.focus();
  }, [screen]);

  const request = useCallback(async (path: string, part?: 'form' | 'screen') => {
    const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, `/api/checkout/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, ...(part ? { part } : {}) }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? (locale === 'en' ? 'Unable to connect.' : 'No pudimos conectar.'));
    return result;
  }, [wallet.address, wallet.accessToken, orderId, locale]);

  const connect = useCallback(async (part: 'form' | 'screen', token: number) => {
    setError('');
    try {
      const result = await request('viewer', part);
      if (token !== generation.current) return;
      const raw = part === 'form' ? result.formUrl : result.viewerUrl;
      if (typeof raw !== 'string') throw new Error(locale === 'en' ? 'Unable to connect.' : 'No pudimos conectar.');
      const url = new URL(raw);
      viewerOrigin.current = url.origin;
      pending.current = {
        type: 'changuito-viewer-connect',
        jobId: result.jobId,
        lang: locale,
        theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        ...(part === 'form' ? { cardToken: result.cardToken ?? '' } : { ticket: result.ticket }),
      };
      setSrc(url.toString());
    } catch (err) {
      if (token !== generation.current) return;
      setError(err instanceof Error ? err.message : (locale === 'en' ? 'Unable to connect.' : 'No pudimos conectar.'));
    }
  }, [request, locale]);

  useEffect(() => {
    const token = ++generation.current;
    setSrc('');
    pending.current = null;
    if ((screen === 'card' || screen === 'browser') && active) void connect(screen === 'card' ? 'form' : 'screen', token);
  }, [screen, active, connect]);

  useEffect(() => {
    function message(event: MessageEvent) {
      if (event.origin !== viewerOrigin.current || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'changuito-viewer-ready' && pending.current) {
        frame.current?.contentWindow?.postMessage(pending.current, event.origin);
        pending.current = null;
      }
      if (event.data?.type === 'changuito-card-applied') {
        if (flowRef.current === 'headless') onCardRef.current();
        else setCardReady(true);
      }
      if (event.data?.type === 'changuito-form-height' && frame.current?.dataset.part === 'form') {
        const height = Number(event.data.height);
        if (Number.isFinite(height)) {
          const next = Math.min(840, Math.max(280, Math.ceil(height)));
          frame.current.style.height = `${next}px`;
        }
      }
    }
    window.addEventListener('message', message);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    function sendTheme() {
      const origin = viewerOrigin.current;
      const target = frame.current?.contentWindow;
      if (!origin || !target) return;
      target.postMessage({ type: 'changuito-viewer-theme', theme: theme.matches ? 'dark' : 'light' }, origin);
    }
    theme.addEventListener('change', sendTheme);
    return () => {
      window.removeEventListener('message', message);
      window.clearInterval(timer);
      theme.removeEventListener('change', sendTheme);
    };
  }, []);

  async function action(path: 'cancel' | 'start') {
    try { setError(''); onUpdate(await request(path)); }
    catch (err) { setError(err instanceof Error ? err.message : (locale === 'en' ? 'Request failed.' : 'No se pudo completar.')); }
  }

  const title = screen === 'card' ? words.cardTitle
    : screen === 'browser' ? words.browserTitle
    : screen === 'paying' ? words.payingTitle
    : screen === 'verification' ? words.verificationTitle
    : screen === 'placed' ? words.placedTitle
    : screen === 'declined' ? words.declinedTitle
    : words.progressTitle;
  const showFrame = (screen === 'card' || screen === 'browser') && src;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return <div className="ck-pay" data-testid="guided-checkout" data-screen={screen}>
    <h3 ref={heading} className="ck-flow-head" tabIndex={-1}>{title}</h3>
    {screen === 'progress' ? (
      <p className="ck-flow-status" role="status" aria-live="polite" data-testid="checkout-phase">
        <span className="ck-spin" aria-hidden="true" />
        {phases[shownPhase] ?? phases.queued}
      </p>
    ) : null}
    {screen === 'paying' ? <p className="ck-flow-status" role="status" aria-live="polite">{words.paying}</p> : null}
    {screen === 'verification' ? <p role="alert">{words.verification}</p> : null}
    {screen === 'placed' ? <p role="status">{words.placed}{status?.storeOrderId ? ` ${status.storeOrderId}` : ''}</p> : null}
    {screen === 'declined' ? <p role="alert">{words.declined}</p> : null}
    {screen === 'progress' ? <p className="ck-note">{m?.preparedAt ? words.feeReady : words.feeWaiting}</p> : null}
    {(screen === 'card' || screen === 'browser') && active ? (
      <p aria-live="off">{words.session}: {clock}</p>
    ) : null}
    {showFrame ? <iframe
      key={screen}
      ref={frame}
      src={src}
      title={screen === 'browser' ? words.browserFrame(pesos) : words.formFrame}
      data-part={screen === 'browser' ? 'screen' : 'form'}
      className={screen === 'browser' ? 'ck-flow-frame ck-flow-browser' : frameStyles.formFrame}
      referrerPolicy="origin"
      sandbox="allow-scripts allow-same-origin"
    /> : null}
    {screen === 'card' && cardReady ? (
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onCard()}>{words.continueToStore}</button>
      </div>
    ) : null}
    {screen === 'progress' && !m?.preparedAt && m?.preparation === 'queued' ? (
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void action('start')}>{words.retry}</button>
      </div>
    ) : null}
    {(screen === 'progress' || screen === 'card' || screen === 'browser' || screen === 'paying')
      && status?.feeStatus !== 'refunded' && (active || !m?.preparedAt) ? (
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void action('cancel')}>
          {m?.preparedAt ? words.closeSession : words.cancelPrep}
        </button>
      </div>
    ) : null}
    {error ? <p role="alert" className="pay-error">{error}</p> : null}
  </div>;
}
