'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import type { Cart, LocationContext } from '@changuito/mcp/types';

import { lockFailureCode, refundFailureCode } from '../lib/funnel';
import { track } from '../lib/analytics';
import type { Receipt } from '../lib/chat-store.ts';
import { escrowCopy } from '../lib/checkout/copy.ts';
import type { QuoteResponse, StatusResponse } from '../lib/checkout/types.ts';
import { OpenConfirmationPending, recoverOpen, submitOpen, type OpenSubmission } from '../lib/checkout/open-submission.ts';
import type { PublicProfile } from '../lib/profile.ts';
import { postFaucet } from '../lib/faucet-client.ts';
import { fetchAs } from '../lib/fetch-as.ts';
import { ensureUserCookie } from '../lib/session-login';
import { explorer } from '../lib/stellar.ts';
import { useBalances } from '../lib/use-balances.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useWallet } from '../lib/use-wallet.ts';
import { useLang } from './LangProvider';
import { useNetwork } from './NetworkProvider';
import { PasswordInput } from './PasswordInput';
import { ManualPaymentPanel } from './ManualPaymentPanel';
import { GuidedCheckout } from './GuidedCheckout';
import { flowLabels, flowRailIndex, flowScreen } from '../lib/checkout/flow.ts';

/**
 * From a full basket to a settled escrow, in four steps:
 *
 *   1. login   — email or Google through Pollar, or Freighter in the browser.
 *   2. lock    — the server quotes goods + envío at belo's USDC rate (order
 *                id, basket hash, USDC amount) and the shopper confirms that
 *                breakdown and types their Día login. The server builds
 *                `open`; the wallet signs the authorization and Channels
 *                pays the fee and sends. The USDC is
 *                now in a vault the program owns, not in an account of ours.
 *   3. shop    — the server starts a sandbox job (services/sandbox) that logs
 *                into the shopper's Día account, fills the cart, picks the
 *                delivery and pays with the operator's card. This dialog
 *                polls /api/checkout/status, which reports the phase.
 *   4. done    — Día placed the order: the resolver settled the escrow to the
 *                treasury. Anything else, a declined card included, refunds.
 *
 * The quote says which run this is (`mode`, lib/shared-card.ts):
 *
 *   - `live` / `mock`: the sandbox logs into the shopper's Día account, so the
 *     Día login has to be in their profile first. When it is not, this dialog
 *     asks for it and saves it (/api/profile, encrypted) *before* anything is
 *     locked; the start route decrypts it. The password lives in this
 *     component's state until that one request, and never in chat-store.
 *   - `demo`: a wallet not on the shared card's member list. No Día login; the
 *     run stops at payment, the USDC comes back, and the last step hands off
 *     to the cart link so the shopper finishes in Día.
 *
 * The dialog never decides an outcome. Every stage after `lock` is what the
 * server read from the chain or the sandbox, and the server reads the chain
 * before it moves anything.
 */
interface Props {
  cart: Cart;
  /** Where the shopper browsed (the chat's session snapshot): the envío is quoted here. */
  location?: Pick<LocationContext, 'postalCode' | 'salesChannel' | 'country'>;
  handoffUrl?: string;
  chatId?: string;
  onClose: () => void;
  onPaid: (receipt: Receipt) => void;
}

const POLL_MS = 3_000;

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const pesos = (centavos: number) => ARS.format(centavos / 100);

interface DiaLogin {
  email: string;
  password: string;
  dni: string;
  street: string;
  number: string;
  phone: string;
}

const EMPTY_LOGIN: DiaLogin = { email: '', password: '', dni: '', street: '', number: '', phone: '' };

function loginReady(d: DiaLogin): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim()) && d.password.length > 0 && /^\d{7,9}$/.test(d.dni.replace(/\D/g, ''));
}

type Step = 'login' | 'review' | 'locking' | 'shopping' | 'done' | 'refunded';

export function CheckoutModal({ cart, location, handoffUrl, onClose, onPaid }: Props) {
  const lang = useLang();
  const copy = escrowCopy(lang);
  const wallet = useWallet();
  const { network } = useNetwork();
  const { data: balance, refresh } = useBalances(wallet.address);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [step, setStep] = useState<Step>('login');
  const [error, setError] = useState<string | null>(null);
  const [cardSent, setCardSent] = useState(false);
  const [funding, setFunding] = useState(false);
  const [openSig, setOpenSig] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<OpenSubmission | null>(null);
  const [dia, setDia] = useState<DiaLogin>(EMPTY_LOGIN);
  // The saved profile (lib/profile.ts), without its password. When it is
  // complete the server decrypts it at /api/checkout/start and nothing is typed.
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [savingDia, setSavingDia] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const quoting = useRef(false);
  const alerted = useRef<string | null>(null);
  const field = (k: keyof DiaLogin) => (e: ChangeEvent<HTMLInputElement>) => setDia((d) => ({ ...d, [k]: e.target.value }));

  // Signed in -> mint the session cookie -> quote. Once.
  useEffect(() => {
    if (!wallet.ready || !wallet.address) {
      setStep('login');
      return;
    }
    if (quote || quoting.current) return;
    quoting.current = true;
    setStep('review');
    void (async () => {
      try {
        const ok = await ensureUserCookie(wallet.address!, wallet.accessToken);
        if (!ok) throw new Error(copy.failed);
        const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/checkout/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cart, handoffUrl, location }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? copy.failed);
        // Profile first, so a saved login does not flash the form for a frame.
        const p = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/profile', { cache: 'no-store' }).catch(() => null);
        if (p?.ok) setProfile((await p.json().catch(() => null)) as PublicProfile | null);
        setQuote(body as QuoteResponse);
        if (body.resumeStatus) { setStatus(body.resumeStatus); setOpenSig(body.resumeStatus.openSig); setStep('shopping'); }
      } catch (e) {
        setError(e instanceof Error ? e.message : copy.failed);
        quoting.current = false;
      }
    })();
  }, [wallet.ready, wallet.address, wallet.accessToken, quote, cart, location, handoffUrl, copy.failed]);

  const short = Boolean(quote && balance && BigInt(balance.usdc) < BigInt(quote.amount));
  const manual = quote?.checkoutKind === 'manual_fee_v1';
  const demo = quote?.mode === 'demo' || status?.mode === 'demo';
  // Only a run that logs into Día needs the login, and it has to be saved first.
  const needsDia = Boolean(quote) && !demo && (!profile?.complete || editing);
  const ready = demo || (Boolean(profile?.complete) && !editing);

  // Saved before the lock, not after: a run that would stop at Día's login
  // page is a lock and a refund for nothing.
  const saveDia = useCallback(async () => {
    if (!loginReady(dia)) {
      setError(copy.diaMissing);
      return;
    }
    setSavingDia(true);
    setError(null);
    try {
      const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: dia.email.trim(), password: dia.password, dni: dia.dni.replace(/\D/g, '') }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? copy.failed);
      setProfile(body as PublicProfile);
      setDia((d) => ({ ...d, password: '' })); // the server has it now
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : copy.failed);
    } finally {
      setSavingDia(false);
    }
  }, [dia, copy.diaMissing, copy.failed]);

  const faucet = useCallback(async () => {
    setFunding(true);
    setError(null);
    try {
      const res = await postFaucet({ address: wallet.address, sign: wallet.accessToken }, network);
      if (!res) throw new Error(copy.failed);
      const body = await res.json().catch(() => null);
      if (!res.ok && res.status !== 429) throw new Error(body?.error ?? copy.failed);
      if (res.status === 429 && body?.note) setError(body.note);
      track('faucet_grant', {});
      track('faucet', { code: res.status === 429 ? 'enough' : 'ok' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.failed);
    } finally {
      setFunding(false);
    }
  }, [copy.failed, network, refresh, wallet.accessToken, wallet.address]);

  const lock = useCallback(async () => {
    if (!quote || !wallet.address) return;
    const pending = pendingOpen?.orderId === quote.orderId ? pendingOpen : null;
    if (!ready && !pending) {
      setError(copy.diaMissing);
      return;
    }
    setStep('locking');
    setError(null);
    let fundedSig: string | null = openSig;
    try {
      // Channels pays the fee. The wallet signs the open authorization.
      if (!fundedSig) {
        let submission = pending;
        if (!submission) {
          const hash = await wallet.openEscrow({
            orderId: quote.orderId,
            amount: quote.amount,
            basketHash: quote.basketHash,
            timeoutSecs: quote.timeoutSecs,
          });
          submission = { orderId: quote.orderId, tx: hash };
          setPendingOpen(submission);
        }
        const opened = await submitOpen((url, init) => fetchAs({ address: wallet.address, sign: wallet.accessToken }, url, init), submission, copy.failed);
        fundedSig = opened.openSig;
        setPendingOpen(null);
        const sig = fundedSig;
        setOpenSig(sig);
        track('escrow_open');
        track('pay_open');
        if (manual && opened.status) {
          setStatus(opened.status);
          setStep('shopping');
          refresh();
          return;
        }
      }
      const sig = fundedSig;
      const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/checkout/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: quote.orderId,
          openSig: sig,
          // No `dia`: the server decrypts the saved profile (a demo needs none).
          address: { street: dia.street, number: dia.number, phone: dia.phone },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? copy.failed);
      setStatus(body as StatusResponse);
      setDia(EMPTY_LOGIN); // sent once; nothing to keep it for
      setStep('shopping');
    } catch (e) {
      console.warn('[checkout] lock failed', e);
      track('failure', { code: lockFailureCode(e instanceof Error ? e.message : '') });
      setError(e instanceof OpenConfirmationPending
        ? (lang === 'en' ? 'Your wallet approval was received, but confirmation is still pending. We are checking this order. You do not need to sign or pay again.'
          : 'Recibimos la aprobación de tu billetera, pero falta confirmar el pedido. Lo estamos consultando. No hace falta volver a firmar ni pagar.')
        : e instanceof Error && e.message ? e.message : copy.failed);
      if (!(e instanceof OpenConfirmationPending)) setPendingOpen(null);
      if (manual && fundedSig) {
        setStatus({ orderId: quote.orderId, checkoutKind: 'manual_fee_v1', stage: 'shopping', phase: 'queued', payment: null,
          storeOrderId: null, openSig: fundedSig, closeSig: null, handoffUrl: null, amountDisplay: '0.10', error: null,
          mode: 'live', alert: null, feeStatus: 'escrowed', manual: { preparation: 'queued', purchase: 'not_started',
            preparedAt: null, viewerExpiresAt: null, sessionActive: false, sequence: 0 } });
        setStep('shopping');
      } else setStep('review');
    }
  }, [quote, wallet, dia, ready, copy.failed, copy.diaMissing, manual, openSig, pendingOpen, lang, refresh]);

  // Confirmation can finish even when the PUT reply never reaches this tab.
  // Poll only the existing order; never build or sign another lock here.
  useEffect(() => {
    if (!manual || !pendingOpen || step !== 'review' || pendingOpen.orderId !== quote?.orderId) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      const recovered = await recoverOpen((url, init) => fetchAs({ address: wallet.address, sign: wallet.accessToken }, url, init), pendingOpen.orderId);
      inFlight = false;
      if (stopped || !recovered) return;
      setOpenSig(recovered.openSig);
      setPendingOpen(null);
      setError(null);
      setStatus(recovered.status!);
      setStep('shopping');
      refresh();
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [manual, pendingOpen, quote?.orderId, step, wallet.address, wallet.accessToken, refresh]);

  // Poll while the sandbox shops.
  useEffect(() => {
    if (step !== 'shopping' || !quote) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, `/api/checkout/status?orderId=${quote.orderId}`, { cache: 'no-store' });
        const body = (await res.json().catch(() => null)) as StatusResponse | null;
        if (stopped || !res.ok || !body) return;
        setStatus(body);
        if (body.alert && alerted.current !== body.alert) {
          alerted.current = body.alert;
          track('failure', { code: body.alert });
        }
        if (body.checkoutKind !== 'manual_fee_v1' && (body.stage === 'done' || body.stage === 'refunded')) {
          setStep(body.stage);
          track(body.stage === 'done' ? 'escrow_settled' : 'escrow_refunded', {});
          if (body.stage === 'done') track('settle');
          else {
            const code = refundFailureCode(body);
            track('refund', { code });
            track('failure', { code });
          }
          refresh();
        }
      } catch {
        /* the next tick tries again */
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [step, quote, refresh, wallet.address, wallet.accessToken]);

  // A finished demo files the chat as completed too, so the demo has an end:
  // the basket becomes a receipt like a real purchase would. The amount says
  // "de prueba": the treasury took testnet USDC and Día was never paid, and the
  // receipt must not read like a store order (chat-store keeps the string as
  // it was on screen). Settled when it reached payment, refunded when it
  // failed before: both end the chat.
  const demoFinished = demo && (step === 'done' || step === 'refunded');
  const finish = useCallback(() => {
    if ((step !== 'done' && !demoFinished) || !quote) return onClose();
    onPaid({
      orderId: quote.orderId.slice(0, 12),
      retailer: cart.retailer,
      paidDisplay: demoFinished ? copy.demoPaid(quote.amountDisplay) : `${quote.amountDisplay} USDC`,
      paidAt: Date.now(),
      lines: cart.lines.filter((l) => l.available).map((l) => ({ name: l.name, quantity: l.quantity, lineTotal: l.lineTotal.display })),
      total: cart.total.display,
    });
  }, [step, demoFinished, quote, cart, copy, onClose, onPaid]);

  // Closing mid-purchase is allowed: the server keeps shopping and the escrow
  // closes either way. Only the view goes.
  const close = step === 'done' || demoFinished ? finish : onClose;
  const rawFlow = status?.manualFlow ?? quote?.manualFlow;
  const steppedFlow = rawFlow === 'guided' || rawFlow === 'headless' ? rawFlow : null;
  const flowNow = steppedFlow ? flowScreen(steppedFlow, status, cardSent) : 'progress';
  const railLabels = steppedFlow ? flowLabels(lang === 'en' ? 'en' : 'es', steppedFlow) : copy.steps;
  const railAt = steppedFlow
    ? flowRailIndex(step, flowNow)
    : step === 'login' ? 0 : step === 'review' || step === 'locking' ? 1 : 2;
  const closeSig = status?.closeSig ?? null;
  const lockSig = status?.openSig ?? openSig;

  useEffect(() => { setCardSent(false); }, [quote?.orderId]);

  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        data-testid="checkout-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{copy.title}</h2>
        </header>

        <div className="ck-step">
          <ol className="ck-rail">
            {railLabels.map((label, i) => (
              <li
                key={label}
                className={i === railAt ? 'ck-rail-step ck-rail-now' : i < railAt ? 'ck-rail-step ck-rail-done' : 'ck-rail-step'}
                aria-current={i === railAt ? 'step' : undefined}
              >
                <span className="ck-rail-n" aria-hidden="true">
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>

          {step === 'login' ? (
            <div className="ck-login" data-testid="checkout-login-step">
              <p id="checkout-login-lead" className="ck-lead">
                {wallet.androidChoices ? uiCopy(lang).wallet.androidLead : copy.loginLead}
              </p>
              <div className="ck-login-actions">
                {wallet.androidChoices ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      data-testid="checkout-email"
                      aria-describedby="checkout-login-lead"
                      disabled={!wallet.enabled || !wallet.ready}
                      onClick={() => wallet.login('email')}
                    >
                      {uiCopy(lang).wallet.emailAria}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-testid="checkout-google"
                      aria-describedby="checkout-login-lead"
                      disabled={!wallet.enabled || !wallet.ready}
                      onClick={() => wallet.login('google')}
                    >
                      {uiCopy(lang).wallet.googleAria}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-testid="checkout-native-login"
                      aria-describedby="checkout-login-lead"
                      aria-busy={nativeBusy}
                      disabled={!wallet.enabled || !wallet.ready || nativeBusy}
                      onClick={() => {
                        setNativeBusy(true);
                        setError(null);
                        void wallet.loginMobile()
                          .catch((err) => setError(err instanceof Error ? err.message : copy.failed))
                          .finally(() => setNativeBusy(false));
                      }}
                    >
                      {nativeBusy ? uiCopy(lang).wallet.nativeBusy : uiCopy(lang).wallet.connectAria}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    data-testid="checkout-login"
                    aria-describedby="checkout-login-lead"
                    disabled={!wallet.enabled || !wallet.ready}
                    onClick={() => wallet.login()}
                  >
                    {copy.loginCta}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {(step === 'review' || step === 'locking') && !quote && !error ? <p className="ck-lead">{copy.preparing}</p> : null}

          {(step === 'review' || step === 'locking') && quote ? (
            <div className="ck-pay" data-testid="checkout-lock-step">
              <dl className="ck-totals" data-testid="checkout-breakdown">
                <div className="ck-total-line">
                  <dt>{copy.subtotalLabel}</dt>
                  <dd>{pesos(quote.subtotalCentavos)}</dd>
                </div>
                <div className="ck-total-line">
                  <dt>{copy.shippingLabel}</dt>
                  <dd data-testid="checkout-shipping">{pesos(quote.shippingCentavos)}</dd>
                </div>
                <div className="ck-total-line">
                  <dt>{copy.totalLabel}</dt>
                  <dd>{pesos(quote.totalCentavos)}</dd>
                </div>
                <div className="ck-total-line">
                  <dt>{copy.rateLabel}</dt>
                  <dd data-testid="checkout-rate">{pesos(Math.round(quote.arsPerUsd * 100))} / USDC</dd>
                </div>
                <div className="ck-total-line ck-total-sum">
                  <dt>{copy.lockLabel}</dt>
                  <dd data-testid="checkout-amount">{quote.amountDisplay} USDC</dd>
                </div>
                {balance ? (
                  <div className="ck-total-line">
                    <dt>{copy.balanceLabel}</dt>
                    <dd>{balance.usdcDisplay} USDC</dd>
                  </div>
                ) : null}
              </dl>
              <p className="ck-note">{manual ? (lang === 'en' ? 'DIA charges groceries and delivery separately in pesos. The final amount is reviewed in DIA.' : 'DIA cobra los productos y el envío aparte, en pesos. Revisá el importe final en DIA.') : copy.rateNote(quote.rateSource)}</p>
              {quote.postalSource === 'profile' && quote.chatPostalCode && quote.chatPostalCode !== quote.postalCode ? (
                <p className="ck-note" data-testid="checkout-postal-note">
                  {copy.postalNote(quote.postalCode, quote.chatPostalCode)}
                </p>
              ) : null}
              <p className="ck-note" data-testid="manual-fee-disclosure">{manual ? (lang === 'en'
                ? 'Lock 0.10 test USDC for checkout preparation. The fee is charged when the browser is ready, even if you never open it, abandon, or DIA declines payment. You then have 15 minutes to pay DIA with your own card. Preparation failures refund the fee.'
                : 'Bloqueás 0,10 USDC de prueba por preparar el pago. La comisión se cobra cuando el navegador está listo, aunque no lo abras, abandones o DIA rechace el pago. Tenés 15 minutos para pagar en DIA con tu tarjeta. Si falla la preparación, devolvemos la comisión.') : copy.escrowNote}</p>

              {demo ? (
                <p className="ck-note ck-demo" data-testid="checkout-demo-note">
                  {copy.demoNote}
                </p>
              ) : !needsDia ? (
                <div className="ck-delivery" data-testid="checkout-dia-profile">
                  <h3 className="ck-title">{copy.diaTitle}</h3>
                  <p className="ck-note">{copy.profileUsing(profile?.email ?? '')}</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={step === 'locking'}>
                    {copy.profileOther}
                  </button>
                </div>
              ) : (
                <fieldset className="ck-delivery" disabled={savingDia} data-testid="checkout-dia">
                  <h3 className="ck-title">{copy.diaTitle}</h3>
                  <p className="ck-note">{copy.diaLead}</p>
                  <div className="ck-form">
                    <label>
                      {copy.emailLabel}
                      <input className="ck-input" type="email" autoComplete="off" value={dia.email} onChange={field('email')} />
                    </label>
                    <label>
                      {copy.passwordLabel}
                      <PasswordInput value={dia.password} onChange={field('password')} testId="checkout-password" />
                    </label>
                    <label>
                      {copy.dniLabel}
                      <input className="ck-input" inputMode="numeric" autoComplete="off" value={dia.dni} onChange={field('dni')} />
                    </label>
                  </div>
                  <details className="ck-more">
                    <summary>{copy.addressMore}</summary>
                    <div className="ck-form">
                      <label>
                        {copy.streetLabel}
                        <input className="ck-input" autoComplete="address-line1" value={dia.street} onChange={field('street')} />
                      </label>
                      <label>
                        {copy.numberLabel}
                        <input className="ck-input" inputMode="numeric" value={dia.number} onChange={field('number')} />
                      </label>
                      <label>
                        {copy.phoneLabel}
                        <input className="ck-input" type="tel" autoComplete="tel" value={dia.phone} onChange={field('phone')} />
                      </label>
                    </div>
                  </details>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn"
                      data-testid="checkout-dia-save"
                      onClick={() => void saveDia()}
                      disabled={savingDia || !loginReady(dia)}
                    >
                      {savingDia ? copy.diaSaving : copy.diaSaveCta}
                    </button>
                  </div>
                </fieldset>
              )}

              {short ? (
                <>
                  <p className="pay-warn">{copy.short}</p>
                  <button type="button" className="btn btn-ghost" onClick={() => void faucet()} disabled={funding}>
                    {funding ? copy.faucetWorking : copy.faucetCta}
                  </button>
                </>
              ) : null}

              {needsDia ? null : (
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn"
                    data-testid="checkout-lock"
                    onClick={() => void lock()}
                    disabled={step === 'locking' || (!pendingOpen && (short || !balance || !ready))}
                  >
                    {step === 'locking' ? (pendingOpen ? (lang === 'en' ? 'Checking confirmation…' : 'Consultando confirmación…') : copy.locking)
                      : pendingOpen ? (lang === 'en' ? 'Check payment and resume' : 'Consultar pago y continuar')
                      : manual ? (lang === 'en' ? 'Lock 0.10 test USDC and prepare checkout' : 'Bloquear 0,10 USDC de prueba y preparar el pago') : copy.lockCta(quote.amountDisplay)}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {step === 'shopping' && manual && quote && steppedFlow ? (
            <GuidedCheckout
              orderId={quote.orderId}
              flow={steppedFlow}
              status={status}
              pesos={cart.total.display}
              cardSent={cardSent}
              onUpdate={setStatus}
              onCard={() => setCardSent(true)}
            />
          ) : null}

          {step === 'shopping' && manual && quote && !steppedFlow ? <ManualPaymentPanel orderId={quote.orderId} status={status} onUpdate={setStatus} /> : null}

          {step === 'shopping' && !manual ? (
            <div className="ck-pay" data-testid="checkout-shopping-step">
              <p className="ck-ok">{copy.lockedNote}</p>
              <p className="ck-waiting" role="status" data-testid="checkout-phase">
                {demo && status?.phase === 'payment'
                  ? copy.demoPayment
                  : (copy.phases[status?.phase ?? 'queued'] ?? copy.phases.queued)}
              </p>
              <p className="ck-note">{demo ? copy.demoShoppingNote : copy.shoppingNote}</p>
              {status?.alert ? (
                <div className="ck-alert" role="alert" data-testid="checkout-alert" data-alert={status.alert}>
                  <p className="ck-alert-title">{copy.alertTitle[status.alert]}</p>
                  <p className="ck-note">{copy.alertBody[status.alert]}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 'done' ? (
            <div className="ck-pay" data-testid="checkout-done-step">
              <h3 className="ck-ok">{demo ? copy.demoDoneTitle : copy.doneTitle}</h3>
              <p className="ck-lead">{demo ? copy.demoDoneLead : copy.doneLead(status?.storeOrderId ?? null)}</p>
              {demo ? null : (
                <p className="ck-note">{copy.doneNote}</p>
              )}
            </div>
          ) : null}

          {step === 'refunded' ? (
            <div className="ck-pay" data-testid="checkout-refunded-step">
              <h3 className="pay-warn">{copy.refundedTitle}</h3>
              <p className="ck-lead">
                {demo ? copy.demoRefundedLead : status?.payment === 'declined' ? copy.declinedLead : copy.refundedLead}
              </p>
              {/* The cause, from lib/checkout/failure.ts: which step it stopped
                  at, or what Día asked for. Never the store's raw text. */}
              {status?.error ? (
                <p className="ck-note" data-testid="checkout-cause">
                  {copy.causeLabel} {status.error}
                </p>
              ) : null}
            </div>
          ) : null}

          {lockSig || closeSig ? (
            <p className="ck-note" data-testid="checkout-txs">
              {lockSig ? (
                <a href={explorer.tx(lockSig)} target="_blank" rel="noopener noreferrer">
                  {copy.lockTx} ↗
                </a>
              ) : null}
              {closeSig ? (
                <>
                  {' · '}
                  <a href={explorer.tx(closeSig)} target="_blank" rel="noopener noreferrer">
                    {step === 'refunded' ? copy.refundTx : copy.settleTx} ↗
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {error ? (
            <p className="pay-error" role="alert" data-testid="checkout-error">
              {error}
            </p>
          ) : null}

          {step === 'done' || step === 'refunded' ? (
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close}>
                {copy.finish}
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="modal-x ck-close" onClick={close} aria-label={copy.close}>
          ×
        </button>
      </section>
    </div>
  );
}
