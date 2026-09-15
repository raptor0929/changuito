'use client';

import { useEffect, useRef, useState } from 'react';

import { STARTERS } from '../lib/agent/prompt';
import { useChat } from '../lib/use-chat';
import { CartCard } from './CartCard';
import { ProductGrid } from './ProductGrid';
import { ToolTrail } from './ToolTrail';

export function Chat() {
  const { state, send, stop } = useChat();
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.blocks]);

  const submit = (text: string) => {
    if (state.streaming) return;
    setDraft('');
    void send(text);
  };

  return (
    <div className="chat">
      <div className="thread" role="log" aria-live="polite" aria-busy={state.streaming}>
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
                  {b.text ? <p className="say">{b.text}</p> : null}
                </div>
              );
            case 'products':
              return <ProductGrid key={b.id} items={b.items} note={b.note} />;
            case 'cart':
              return <CartCard key={b.id} cart={b.cart} handoffUrl={b.handoffUrl} />;
            case 'error':
              return (
                <p key={b.id} className="bubble is-error" role="alert">
                  {b.message}
                </p>
              );
          }
        })}

        {state.streaming && state.blocks.at(-1)?.kind === 'user' ? (
          <p className="bubble is-agent thinking">Pensando…</p>
        ) : null}
        <div ref={bottom} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pedile algo al agente…"
          disabled={state.streaming}
          autoFocus
        />
        {state.streaming ? (
          <button type="button" className="btn btn-ghost" onClick={stop}>
            Parar
          </button>
        ) : (
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Enviar
          </button>
        )}
      </form>
    </div>
  );
}

/** Step 1 of the flow: say what this does before asking the user to type. */
function Greeting({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="greeting">
      <h2>Hola 👋</h2>
      <p>
        Busco productos en supermercados argentinos de verdad, armo el carrito y te paso el link
        para completarlo. El pago se liquida en USDC sobre Stellar testnet.
      </p>
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
