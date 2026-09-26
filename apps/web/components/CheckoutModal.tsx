'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import type { DepositIntent, DepositStatus } from '../app/api/deposit/route.ts';
import type { VerifyResponse } from '../app/api/order/verify/route.ts';
import { track } from '../lib/analytics';
import { appMode } from '../lib/app-mode.ts';
import type { Receipt } from '../lib/chat-store.ts';
import { checkoutCopy } from '../lib/checkout-copy.ts';
import { DEFAULT_NETWORK } from '../lib/deployments.ts';
import { pollarEnabledOn } from '../lib/pollar.ts';
import { realModeNeedsProof } from '../lib/real-mode.ts';
import { isFramableCheckout, STOREFRONT_HOSTS } from '../lib/storefront.ts';
import { useNetworkAccess } from '../lib/use-network-access.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof, type WalletProof, type WalletSigner } from '../lib/wallet-proof.ts';
import { CardPanel } from './CardPanel';
import { CopyField } from './CopyField';
import { useNetwork } from './NetworkProvider';

/**
 * The two steps between a full basket and a receipt: send the importe, then
 * pay at the store in a frame.
 *
 * ## Why the login is not in the frame
 *
 * A login form inside someone else's chrome is the exact shape of a phishing
 * page, and a shopper has no way to tell ours from a real one. So the frame
 * only ever shows checkout, and "entrar a mi cuenta" opens a top-level tab on
 * the store's own origin — real URL bar, real certificate, and the only place
 * a password manager will offer to fill.
 *
 * ## Why there is always a tab
 *
 * The store's checkout sets a `samesite=none` cookie. Safari blocks those in a
 * third-party frame by default, Firefox partitions them, and Chrome's tracking
 * protection covers a share of users. Neither `requestStorageAccess()` (called
 * by the embedded page) nor `requestStorageAccessFor()` (needs the embedded
 * origin's Permissions-Policy) is ours to grant, so this cannot be fixed from
 * here. "Abrir en una pestaña" is therefore a co-primary path, worded as an
 * equal, not a fallback the shopper reaches after something breaks.
 *
 * ## Why a button says the payment happened
 *
 * The frame is cross-origin. We cannot read its DOM, its URL, or an
 * `orderPlaced` event — that is the browser working correctly. So the shopper
 * tells us, and the server corroborates by re-reading the cart at the store:
 * lib/order-check.ts explains what that can and cannot establish. It is never
 * treated as proof, and a store that disagrees never becomes an accusation —
 * the shopper is the one who was there.
 *
 * ## Why the card is optional
 *
 * The frame is the store's real checkout, so a shopper's own card already
 * works and costs us nothing. The single-use card is for the one who would
 * rather not put theirs into a page they reached through a chat. It is offered
 * only where the deployment can actually mint one — `intent.cardAvailable` —
 * and given back when this dialog closes, because a card left alive is money
 * sitting somewhere nobody is watching.
 *
 * ## Why preview pays with one button
 *
 * A visitor with no session has no wallet, so "send this importe to this
 * address" is an instruction they cannot follow. `POST /api/deposit/demo`
 * signs for them out of the demo wallet, and this dialog offers it as a single
 * button instead of the address-and-memo fields. Nothing after it changes: the
 * same 4s poll sees the same payment land on the same ledger.
 *
 * The button is behind `intent.demoPayable` rather than behind the mode alone,
 * so a deployment with no `DEMO_WALLET_SECRET` falls back to showing the
 * address and the memo. That path is not a demo any more — it is an operator
 * paying by hand — but it works, which is better than a button that 503s.
 *
 * ## Why it signs in modo real
 *
 * On a real network `POST /api/deposit` is a door onto actual USDC, so
 * `lib/deposit-gate.ts` asks the wallet to prove itself before it will hand out
 * an address to pay into. The dialog asks for that signature up front rather
 * than letting the server refuse: `realModeNeedsProof` is shared with the gate
 * so the two cannot disagree about when one is wanted. In modo prueba nothing
 * signs and a guest with no wallet at all shops exactly as before.
 */

interface Props {
  cart: Cart;
  handoffUrl?: string;
  /**
   * The conversation this basket came out of, when it has one and the server
   * could have filed it. One chat is one order, and the server is where that
   * is actually held — ShopProvider refuses to let a shopper *type* a second
   * basket into a paid chat, and `POST /api/deposit` refuses to quote one.
   * Absent in preview, where nothing is recorded at all.
   */
  chatId?: string;
  onClose: () => void;
  onPaid: (receipt: Receipt) => void;
}

/**
 * `usePollar()` throws outside a provider, and there are two places without
 * one: a deployment with no Pollar key, and app/dev/ui, which renders this
 * dialog on its own. The same split WalletWidget and PaymentModal make — but
 * ending in the dialog either way rather than in `null`, because checkout in
 * modo prueba has never needed a wallet and must not start now.
 */
export function CheckoutModal(props: Props) {
  const { network } = useNetwork();
  return pollarEnabledOn(network) ? (
    <CheckoutWithWallet {...props} />
  ) : (
    <CheckoutDialog {...props} address={null} sign={null} />
  );
}

function CheckoutWithWallet(props: Props) {
  const { wallet, isAuthenticated } = usePollar();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  return <CheckoutDialog {...props} address={address} sign={sign} />;
}

interface DialogProps extends Props {
  /** The logged-in wallet, or null when there is none to sign with. */
  address: string | null;
  sign: WalletSigner | null;
}

type Step = 'deposit' | 'checkout';

/** 4s: fast enough to feel live, slow enough that a long wait is not a flood. */
const DEPOSIT_POLL_MS = 4_000;
/** 5s against the store, which is someone else's server. */
const IDENTIFY_POLL_MS = 5_000;
/** ~20s before the tab is promoted. Past that the frame is probably blocked. */
const IDENTIFY_PATIENCE = 4;
/** Stop asking eventually; the manual button is always there. */
const IDENTIFY_MAX = 12;

function CheckoutDialog({ cart, handoffUrl, chatId, onClose, onPaid, address, sign }: DialogProps) {
  const { network } = useNetwork();
  const copy = checkoutCopy(network);

  // Null until the server answers, and null forever for a guest with no
  // address — which is right, because a guest cannot be in a gated mode.
  const mode = useNetworkAccess(address)?.[network].mode ?? null;

  const [step, setStep] = useState<Step>('deposit');
  const [intent, setIntent] = useState<DepositIntent | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DepositStatus | null>(null);

  // Preview's one-button payment. `demoSent` outlives the request: once the
  // payment is submitted the button must stay down until the poll confirms,
  // or an impatient second press pays the same memo twice.
  const [demoPaying, setDemoPaying] = useState(false);
  const [demoSent, setDemoSent] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const [identified, setIdentified] = useState(false);
  const [polls, setPolls] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<VerifyResponse | null>(null);

  // The fixture stands in for the store only where it exists. app/dev/checkout
  // notFound()s in production, and modo prueba is reachable there too — framing
  // a 404 would be a worse rehearsal than framing the real checkout, which is
  // safe either way because the importe in modo prueba is play money.
  const rehearsal = network !== 'mainnet' && process.env.NODE_ENV !== 'production';
  const framable = Boolean(handoffUrl) && isFramableCheckout(handoffUrl!);
  const frameSrc = rehearsal
    ? `/dev/checkout?retailer=${encodeURIComponent(cart.retailer)}&total=${encodeURIComponent(cart.total.display)}`
    : framable
      ? handoffUrl!
      : null;

  const storeUrl = STOREFRONT_HOSTS[cart.retailer]
    ? `https://${STOREFRONT_HOSTS[cart.retailer]}`
    : null;

  const itemsAtHandoff = cart.lines.filter((l) => l.available).length;

  // A ref because giving the card back is not a render, and because the
  // pagehide listener below has to read the latest value without being torn
  // down and rebuilt every time something else in this dialog changes.
  const cardLive = useRef(false);
  const release = useCallback(() => {
    if (!cardLive.current || !intent) return;
    cardLive.current = false;
    // `keepalive` so it survives the unload this is sometimes called during.
    // Nothing waits for the answer: the server logs a card it could not
    // terminate loudly enough that a person will find it, and there is
    // nothing useful to tell the shopper about it either way.
    void fetch('/api/card/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memo: intent.memo, network }),
      keepalive: true,
    }).catch(() => {});
  }, [intent, network]);

  // The tab closing is the one exit that does not go through a button of ours.
  useEffect(() => {
    const go = () => release();
    window.addEventListener('pagehide', go);
    return () => window.removeEventListener('pagehide', go);
  }, [release]);

  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);

  // Mint once. A second mint would hand the shopper a second código for the
  // same basket, and the código is the one thing that has to stay stable — it
  // is what makes the importe land on this order rather than somewhere else.
  //
  // The ref is the whole guard, and deliberately **not** a `live` flag in a
  // cleanup. StrictMode unmounts and remounts every effect in dev: a cleanup
  // would cancel the first mint's response while the remount declined to fire
  // a second, so the dialog sat on "Preparando…" for ever and only in dev.
  // Settling state after an unmount is a no-op in React 18, so there is
  // nothing here for a cleanup to protect against.
  const minted = useRef(false);
  useEffect(() => {
    if (minted.current) return;

    // A gated network waits for the server's answer about this wallet. `null`
    // is "not yet", not "no" — minting now would ask without a signature and
    // spend the one mint on a refusal.
    const gated = network !== DEFAULT_NETWORK;
    if (gated && mode === null) return;
    const needsProof = gated && mode !== null && realModeNeedsProof(mode);

    // Deliberately before `minted.current`: the shopper may still log in, and
    // when they do this effect runs again with an address and mints properly.
    // The ref is what makes that safe — one mint, however many times we get here.
    if (needsProof && (!address || !sign)) {
      setMintError('Iniciá sesión con tu cuenta para pagar.');
      return;
    }

    minted.current = true;
    setMintError(null);
    (async () => {
      try {
        let proof: WalletProof | undefined;
        if (needsProof) {
          const signed = await signWalletProof(sign!, 'deposit', address!);
          if (!signed) {
            // A passkey smart wallet (C…) lands here: it cannot sign SEP-53 at
            // all, so this is the end of the road rather than a retry.
            setMintError('No pudimos confirmar tu sesión. Probá de nuevo.');
            return;
          }
          proof = signed;
        }
        const res = await fetch('/api/deposit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ centavos: cart.total.centavos, network, address, proof, chatId }),
        });
        const body = await res.json();
        if (!res.ok) {
          // `message` first: the gate's `error` is a code for the logs, and
          // its `message` is the sentence written for the shopper.
          const said = typeof body?.message === 'string' ? body.message : body?.error;
          setMintError(typeof said === 'string' ? said : 'No pudimos preparar el pago.');
          return;
        }
        setIntent(body as DepositIntent);
      } catch {
        setMintError('No pudimos preparar el pago. Revisá la conexión y volvé a intentar.');
      }
    })();
  }, [cart.total.centavos, network, mode, address, sign, chatId]);

  // Poll until it lands. A 502 is the network being unreadable, not a missing
  // importe, so it leaves the screen saying "esperando" rather than "no llegó".
  useEffect(() => {
    if (!intent || deposit?.status === 'confirmed') return;
    let live = true;
    const tick = async () => {
      try {
        const q = new URLSearchParams({
          memo: intent.memo,
          amount: intent.amount,
          network: intent.network,
        });
        const res = await fetch(`/api/deposit?${q}`);
        if (!res.ok || !live) return;
        const body = (await res.json()) as DepositStatus;
        if (!live || body.status !== 'confirmed') return;
        setDeposit(body);
        track('deposit_confirmed', { network: intent.network });
      } catch {
        /* keep waiting */
      }
    };
    void tick();
    const id = setInterval(tick, DEPOSIT_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [intent, deposit?.status]);

  // Whether the shopper's session reached the store, asked of the store rather
  // than of the frame — the one reading that routes around the cross-origin
  // wall. Only for a real storefront: the fixture has no orderForm to carry a
  // profile, so there "Ya ingresé" is the whole mechanism.
  useEffect(() => {
    if (step !== 'checkout' || rehearsal || identified || !handoffUrl) return;
    if (polls >= IDENTIFY_MAX) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        const res = await fetch('/api/order/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ retailer: cart.retailer, handoffUrl, itemsAtHandoff }),
        });
        if (!res.ok || !live) return;
        const body = (await res.json()) as VerifyResponse;
        if (!live) return;
        if (body.identified) setIdentified(true);
      } catch {
        /* the manual button covers this */
      } finally {
        if (live) setPolls((n) => n + 1);
      }
    }, IDENTIFY_POLL_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [step, rehearsal, identified, polls, handoffUrl, cart.retailer, itemsAtHandoff]);

  const payWithDemoWallet = useCallback(async () => {
    if (!intent || demoPaying || demoSent) return;
    setDemoPaying(true);
    setDemoError(null);
    try {
      const res = await fetch('/api/deposit/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memo: intent.memo, amount: intent.amount, network: intent.network }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // `message` first, same order as the mint above: the route's `error`
        // is a code for the logs and `message` is the sentence for a person.
        const said = typeof body?.message === 'string' ? body.message : null;
        setDemoError(said ?? copy.demoPayError);
        return;
      }
      // Nothing to do with the hash. The poll that was already running finds
      // the payment the same way it would find one the shopper sent, which is
      // the point — preview settles through production's code.
      setDemoSent(true);
      track('demo_pay', { network: intent.network });
    } catch {
      setDemoError(copy.demoPayError);
    } finally {
      setDemoPaying(false);
    }
  }, [intent, demoPaying, demoSent, copy.demoPayError]);

  const settle = useCallback(() => {
    if (!intent) return;
    // Before the receipt, not after: the order is over, and the residual goes
    // back to the wallet the moment the card dies.
    release();
    onPaid({
      // The código is the order's name everywhere: it is what tied the importe
      // to this basket on the ledger, so it is what a person chasing it later
      // has to quote. Minting a second id here would give them two.
      orderId: intent.memo,
      retailer: cart.retailer,
      paidDisplay: `${intent.amount} ${intent.asset.code}`,
      paidAt: Date.now(),
      lines: cart.lines
        .filter((l) => l.available)
        .map((l) => ({ name: l.name, quantity: l.quantity, lineTotal: l.lineTotal.display })),
      total: cart.total.display,
    });
  }, [intent, cart, onPaid, release]);

  async function confirmPaid() {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/order/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retailer: cart.retailer, handoffUrl: handoffUrl ?? '', itemsAtHandoff }),
      });
      const body: VerifyResponse = res.ok
        ? await res.json()
        : { verified: false, identified: false, items: itemsAtHandoff, unknown: true };
      setVerdict(body);
      track('order_verify', { verified: String(body.verified), unknown: String(body.unknown) });
      if (body.verified) settle();
    } catch {
      setVerdict({ verified: false, identified: false, items: itemsAtHandoff, unknown: true });
    } finally {
      setVerifying(false);
    }
  }

  const confirmed = deposit?.status === 'confirmed';
  // Preview *and* a deployment that can actually sign. Both, because the mode
  // alone would render a button that 503s on a checkout with no secret set.
  const demoPays = Boolean(intent) && appMode(network) === 'preview' && intent!.demoPayable;
  // The store has had four chances to say it knows this shopper and has not.
  // Most likely the frame's cookies are being blocked, which we cannot fix
  // from here — so the tab stops being the quiet option and becomes the loud
  // one, before the shopper spends another minute staring at a logged-out cart.
  const blocked = step === 'checkout' && !identified && polls >= IDENTIFY_PATIENCE;

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
          <button type="button" className="modal-x" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </header>

        {step === 'deposit' ? (
          <div className="ck-step" data-testid="checkout-deposit">
            <h3 className="ck-title">{copy.depositTitle}</h3>
            <p className="ck-lead">{copy.depositLead}</p>

            {mintError ? (
              <p className="pay-error" data-testid="checkout-mint-error">
                {mintError}
              </p>
            ) : !intent ? (
              <p className="ck-lead">Preparando…</p>
            ) : (
              <>
                <dl className="ck-fields">
                  <CopyField
                    label={copy.amountLabel}
                    value={`${intent.amount} ${intent.asset.code}`}
                    copyValue={intent.amount}
                    testid="checkout-amount"
                  />
                  {/* Nothing to copy in preview: there is no wallet to paste
                      it into, and an address nobody can pay from is noise. */}
                  {demoPays ? null : (
                    <>
                      <CopyField
                        label={copy.addressLabel}
                        value={intent.address}
                        testid="checkout-address"
                        mono
                      />
                      <CopyField label={copy.memoLabel} value={intent.memo} testid="checkout-memo" mono />
                    </>
                  )}
                </dl>
                {demoPays ? null : <p className="ck-note">{copy.memoNote}</p>}
                <p className="ck-note">{copy.refundNote}</p>

                {demoPays && !confirmed ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      data-testid="checkout-demo-pay"
                      disabled={demoPaying || demoSent}
                      onClick={() => void payWithDemoWallet()}
                    >
                      {demoPaying ? copy.demoPayWorking : copy.demoPayCta}
                    </button>
                    {demoError ? (
                      <p className="pay-error" data-testid="checkout-demo-error">
                        {demoError}
                      </p>
                    ) : null}
                  </>
                ) : null}

                {/* Hidden until there is something to wait for. In preview
                    "esperando que llegue" before the button is pressed would
                    be waiting on the shopper, phrased as waiting on the
                    network. */}
                {demoPays && !demoSent && !confirmed ? null : (
                  <p
                    className={confirmed ? 'ck-ok' : 'ck-waiting'}
                    role="status"
                    data-testid="checkout-deposit-status"
                  >
                    {confirmed ? copy.confirmed : copy.waiting}
                  </p>
                )}
              </>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                data-testid="checkout-continue"
                disabled={!confirmed}
                onClick={() => setStep('checkout')}
              >
                Seguir
              </button>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="ck-step" data-testid="checkout-store">
            <h3 className="ck-title">{copy.checkoutTitle}</h3>
            <p className="ck-lead">{copy.checkoutLead}</p>

            <div className="ck-login">
              <p className="ck-note">{copy.loginLead}</p>
              <div className="ck-login-actions">
                {storeUrl ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid="checkout-login"
                    onClick={() => window.open(storeUrl, '_blank', 'noopener,noreferrer')}
                  >
                    {copy.loginCta}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="checkout-logged-in"
                  onClick={() => setIdentified(true)}
                  disabled={identified}
                >
                  Ya ingresé
                </button>
              </div>
              {identified ? (
                <p className="ck-ok" role="status" data-testid="checkout-identified">
                  {copy.identified}
                </p>
              ) : null}
            </div>

            {intent?.cardAvailable ? (
              <CardPanel
                memo={intent.memo}
                network={network}
                copy={copy}
                onIssued={() => {
                  cardLive.current = true;
                }}
              />
            ) : null}

            {frameSrc ? (
              <iframe
                className="ck-frame"
                data-testid="checkout-frame"
                src={frameSrc}
                title={copy.checkoutTitle}
                // Payment needs scripts, forms and its own cookies; the rest
                // stays off. `allow-same-origin` is what lets the store keep a
                // session at all — without it every request is an opaque
                // origin and checkout cannot work.
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
                referrerPolicy="no-referrer"
              />
            ) : null}

            <div className={blocked ? 'ck-tab ck-tab-up' : 'ck-tab'}>
              {handoffUrl ? (
                <a
                  className={blocked ? 'btn' : 'btn btn-ghost'}
                  data-testid="checkout-tab"
                  href={handoffUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy.openTab}
                </a>
              ) : null}
              <span className="ck-note">{copy.openTabNote}</span>
            </div>

            {verdict ? (
              <p
                className={verdict.verified ? 'ck-ok' : 'pay-warn'}
                role="status"
                data-testid="checkout-verdict"
              >
                {verdict.verified ? copy.verified : verdict.unknown ? copy.unreachable : copy.unverified}
              </p>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                data-testid="checkout-paid"
                onClick={() => void confirmPaid()}
                disabled={verifying}
              >
                {verifying ? copy.checking : copy.paidCta}
              </button>
              {/* Only after the store has been asked and did not agree. The
                  shopper was there and we were not, so the flow continues on
                  their word — but not before we have tried to corroborate it. */}
              {verdict && !verdict.verified ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="checkout-anyway"
                  onClick={settle}
                >
                  Seguir igual
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
