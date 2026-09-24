'use client';

import type { AuthState } from '@pollar/core';
import { LoginModalTemplate } from '@pollar/react';
import '@pollar/react/styles.css';
import { useState } from 'react';

import { TurnProgressLine, UserBubble } from '../../../components/Chat';
import { FaucetConfirm } from '../../../components/FaucetConfirm';
import { PollarSpanish } from '../../../components/PollarSpanish';
import type { ChatState } from '../../../lib/chat-state';
import { ENOUGH_UNITS } from '../../../lib/faucet-policy';

/**
 * The fixtures that need event handlers. A server component cannot hand a
 * function to a client one, which is what made this page a 500.
 */

const noop = () => {};

const DELIVERED = { kind: 'user' as const, id: 'd1', text: 'galletas de avena para 4' };

/** The bug this scheme exists for: the supermarket and the postal code, lost. */
const FAILED_LOGIN = {
  kind: 'user' as const,
  id: 'd2',
  text: 'jumbo 1430',
  failed: { reason: 'login' as const, message: 'Para seguir, iniciá sesión.' },
};

/** Failed, but the user typed something after it — the mark stays, the button goes. */
const FAILED_OLD = {
  kind: 'user' as const,
  id: 'd3',
  text: 'sumale dos docenas de huevos',
  failed: { reason: 'network' as const, message: 'Se cortó la conexión antes de terminar. Probá de nuevo.' },
};

/** The server had it, and the answer never came: "se cortó", not "no se envió". */
const DROPPED = {
  kind: 'user' as const,
  id: 'd4',
  text: 'CP 1414, Día',
  failed: { reason: 'dropped' as const, message: 'Se cortó la conexión antes de terminar. Probá de nuevo.' },
};

const SEARCHING: ChatState = {
  streaming: true,
  progress: { stage: 'thinking', hop: 1, writing: false },
  blocks: [
    { kind: 'user', id: 'p1', text: 'CP 1414, Día' },
    { kind: 'say', id: 'p2', text: '', thinking: '', tools: [{ id: 't1', name: 'search_products' }] },
  ],
};

const IDLE: AuthState = { step: 'idle' } as AuthState;
const CODE: AuthState = { step: 'entering_code' } as AuthState;

export function Fixtures() {
  const [faucet, setFaucet] = useState<'empty' | 'full' | null>(null);

  return (
    <>
      {/* Reaching an undelivered message for real costs three free turns and
          a logged-out browser, so the states live here instead. */}
      <UserBubble block={DELIVERED} canRetry={false} onRetry={noop} />
      <UserBubble block={FAILED_LOGIN} canRetry onRetry={noop} />
      <UserBubble block={FAILED_OLD} canRetry={false} onRetry={noop} />
      <UserBubble block={DROPPED} canRetry onRetry={noop} />
      <p className="bubble is-error" role="alert">
        Se cortó la respuesta. Probá de nuevo.
      </p>

      {/* Static: the real composer is sticky, and here it would slide over
          the fixtures below it. */}
      <form
        className="composer"
        style={{ position: 'static' }}
        data-testid="fixture-progress"
        onSubmit={(e) => e.preventDefault()}
      >
        <textarea className="composer-input" placeholder="¿Qué necesitás del súper y para cuántos?" rows={2} disabled />
        <button type="button" className="btn btn-ghost">
          Parar
        </button>
        <TurnProgressLine state={SEARCHING} />
      </form>

      <div className="cart-actions">
        <button type="button" className="btn btn-sm" data-testid="fixture-faucet" onClick={() => setFaucet('empty')}>
          Cargar USDC (saldo 0)
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFaucet('full')}>
          Cargar USDC (saldo 100)
        </button>
      </div>
      {faucet ? (
        <FaucetConfirm
          balanceUnits={faucet === 'empty' ? 0n : ENOUGH_UNITS}
          onClose={() => setFaucet(null)}
          onConfirm={() => setFaucet(null)}
        />
      ) : null}

      {/* Pollar's own template, so the translation runs against the real
          markup rather than a copy of it. */}
      <PollarSpanish />
      <div data-testid="fixture-pollar" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[IDLE, CODE].map((authState) => (
          <div key={authState.step} className="pollar-overlay" style={{ position: 'static', inset: 'auto' }}>
            <LoginModalTemplate
              theme="light"
              accentColor="#f4b942"
              logoUrl="/brand/mascot-idle.png"
              emailEnabled
              embeddedWallets={false}
              providers={{ google: true, discord: false, x: false, github: false, apple: false }}
              walletAdapters={[]}
              appName="Changuito"
              email="vos@ejemplo.com"
              authState={authState}
              onBack={noop}
              onCancel={noop}
              onRetry={noop}
            />
          </div>
        ))}
      </div>
    </>
  );
}
