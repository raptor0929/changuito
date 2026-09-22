'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { STARTERS } from '../lib/agent/prompt';

/** Rotating fun rioplatense prompts for the fat composer box. */
const COMPOSER_PLACEHOLDERS = [
  '¿Qué necesitás del súper? Contanos para cuántos cocinás y te armamos la lista de lo que necesitás.',
  '¿Asado, milanesas o algo light? Decime para cuántos y Changuito arma la lista.',
  'Contame la receta y para cuántos cocinás. Yo me encargo del súper.',
  '¿Semana laboral o juntada? Decime cuántos son y qué comen, y armamos el carrito.',
];

import { FREE_TURNS, LOGIN_CTA, LOGIN_REQUIRED_MESSAGE, loginGateBannerText } from '../lib/login-constants';
import type { OpenedOrder } from '../lib/order';
import { pollarEnabled } from '../lib/pollar';
import { useChat } from '../lib/use-chat';
import { CartCard } from './CartCard';
import { OrderPanel } from './OrderPanel';
import { PaymentModal } from './PaymentModal';
import { ProductGrid } from './ProductGrid';
import { MarkdownText } from './MarkdownText';
import { ReportBug } from './ReportBug';
import { ToolTrail } from './ToolTrail';

export function Chat() {
  // Same split as WalletWidget: usePollar only mounts inside a real provider.
  return pollarEnabled ? <ChatWithPollar /> : <ChatCore />;
}

function ChatWithPollar() {
  const { isAuthenticated, openLoginModal, wallet } = usePollar();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  return <ChatCore isAuthenticated={isAuthenticated} openLoginModal={openLoginModal} address={address} />;
}

function ChatCore({
  isAuthenticated = false,
  openLoginModal,
  address = null,
}: {
  isAuthenticated?: boolean;
  openLoginModal?: () => void;
  address?: string | null;
}) {
  const { state, send, stop, loginRequired, clearLoginRequired } = useChat({ isAuthenticated, address });
  const [draft, setDraft] = useState('');
  const [placeholderIdx] = useState(() => Math.floor(Math.random() * COMPOSER_PLACEHOLDERS.length));
  // The basket the payment modal is open over. A cart, not a block id: the
  // user pays for what a card showed, and that object is the record of it.
  const [paying, setPaying] = useState<{ cart: Cart; handoffUrl?: string } | null>(null);
  // One open order at a time. It outlives the modal: the user leaves to finish
  // the basket at the store, and has to find this again when they come back.
  const [order, setOrder] = useState<OpenedOrder | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    // The page itself does not scroll. Jumping with scrollIntoView walks
    // ancestors and, on iOS, pans the visual viewport so the composer
    // disappears under the keyboard. Scroll the thread only.
    // The empty greeting is read from the top; pinning to the end would
    // hide "Hola" behind the fold of a short phone.
    if (state.blocks.length === 0) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.blocks]);

  // After Pollar login, drop the guest latch and any soft-limit line already
  // written into the transcript.
  useEffect(() => {
    if (isAuthenticated) clearLoginRequired();
  }, [isAuthenticated, clearLoginRequired]);

  // Guests at the limit. Signed-in shoppers never match, even if the latch is
  // still true for this render or the free-turn count is already spent.
  const gateText = loginGateBannerText({ isAuthenticated, loginRequired });
  const gated = gateText !== null;
  const loginCopyVisible =
    loginGateBannerText({ isAuthenticated, loginRequired: true, turnsUsed: FREE_TURNS }) !== null;

  // `disabled` blurs the composer the moment a turn starts, and nothing gives
  // the focus back when it ends — so the obvious thing, typing the next
  // message, silently goes nowhere. Shopping is a conversation; the cursor
  // should be waiting where the next sentence goes.
  useEffect(() => {
    if (!state.streaming && !gated) composer.current?.focus();
  }, [state.streaming, gated]);

  const submit = (text: string) => {
    if (state.streaming || gated) return;
    setDraft('');
    void send(text);
  };

  return (
    // `is-empty` is the hook for the mobile first-screen layout. The class is
    // server-rendered with the initial state, so compact CSS applies before
    // hydration and the shell can target it with :has().
    <div className={state.blocks.length === 0 ? 'chat is-empty' : 'chat'}>
      <div
        ref={thread}
        className="thread"
        data-testid="chat-thread"
        role="log"
        aria-live="polite"
        aria-busy={state.streaming}
      >
        {state.blocks.length === 0 ? <Greeting onPick={submit} /> : null}

        {state.blocks.map((b) => {
          switch (b.kind) {
            case 'user':
              return (
                <p key={b.id} className="bubble is-user">
                  {b.text}
                </p>
              );
            case 'say':
              return (
                <div key={b.id} className="bubble is-agent">
                  <ToolTrail tools={b.tools} />
                  {b.thinking && !b.text ? <p className="thinking">{b.thinking}</p> : null}
                  {b.text ? <MarkdownText text={b.text} /> : null}
                </div>
              );
            case 'products':
              return <ProductGrid key={b.id} items={b.items} note={b.note} />;
            case 'cart':
              return (
                <CartCard
                  key={b.id}
                  cart={b.cart}
                  handoffUrl={b.handoffUrl}
                  // No wallet in this build means no pay button, rather than a
                  // button that opens a modal with nothing to sign with.
                  onPay={
                    pollarEnabled
                      ? (cart) => setPaying({ cart, handoffUrl: b.handoffUrl })
                      : undefined
                  }
                />
              );
            case 'error':
              // The soft-limit line is guest copy. Once the shopper is signed
              // in it is not an error, and leaving it in the thread reads as
              // the gate still being shut.
              if (b.message === LOGIN_REQUIRED_MESSAGE && !loginCopyVisible) return null;
              return (
                <p key={b.id} className="bubble is-error" role="alert">
                  {b.message}
                </p>
              );
          }
        })}

        {state.streaming && state.blocks.at(-1)?.kind === 'user' ? (
          // Copy first, then the back-and-forth search GIF. The idle PNG is
          // only the reduced-motion fallback (hidden in CSS until then).
          <p className="bubble is-agent thinking" data-testid="search-loading">
            <span>Buscando en el súper…</span>
            <img
              className="thinking-mascot thinking-mascot-motion"
              src="/brand/animacion-busqueda.gif"
              alt=""
              aria-hidden="true"
              width={54}
              height={36}
            />
            <img
              className="thinking-mascot thinking-mascot-still"
              src="/brand/mascot-idle.png"
              alt=""
              aria-hidden="true"
              width={25}
              height={36}
            />
          </p>
        ) : null}
        <ReportBug />
      </div>

      {gated && gateText ? (
        <div className="login-gate-banner" data-testid="login-gate-banner" role="status">
          <img
            className="login-gate-mascot"
            src="/brand/mascot-idle.png"
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
          />
          <div className="login-gate-copy">
            <p className="login-gate-title">Para seguir, iniciá sesión</p>
            <p>{gateText}</p>
          </div>
          {openLoginModal ? (
            <button type="button" className="btn" onClick={openLoginModal}>
              {LOGIN_CTA}
            </button>
          ) : (
            <p className="login-gate-muted">El inicio de sesión no está configurado en este build.</p>
          )}
        </div>
      ) : null}

      {order ? <OrderPanel order={order} onDismiss={() => setOrder(null)} /> : null}

      <form
        className="composer"
        data-testid="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          ref={composer}
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          placeholder={COMPOSER_PLACEHOLDERS[placeholderIdx] ?? COMPOSER_PLACEHOLDERS[0]}
          rows={2}
          enterKeyHint="send"
          disabled={state.streaming || gated}
          autoFocus
        />
        {state.streaming ? (
          <button type="button" className="btn btn-ghost" onClick={stop} aria-label="Parar respuesta">
            Parar
          </button>
        ) : (
          <button type="submit" className="btn" data-testid="composer-send" disabled={!draft.trim() || gated}>
            Enviar
          </button>
        )}
        {state.streaming ? (
          <p className="composer-hint" role="status">
            Esperá a que termine, o tocá Parar para mandar otro mensaje.
          </p>
        ) : null}
      </form>

      {paying ? (
        <PaymentModal
          cart={paying.cart}
          handoffUrl={paying.handoffUrl}
          onClose={() => setPaying(null)}
          onOpened={setOrder}
        />
      ) : null}
    </div>
  );
}

/** Empty-chat intro under the greeting, then starter chips. */
const GREETING_BODY = 'Changuito te ayuda a armar tus compras en el supermercado.';

function Greeting({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="greeting" data-testid="greeting">
      <h2>Hola 👋</h2>
      <p className="greeting-body" data-testid="greeting-body">{GREETING_BODY}</p>
      <p className="greeting-hint">Probá con:</p>
      <ul className="starters">
        {STARTERS.map((s) => (
          <li key={s}>
            <button type="button" className="starter" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
