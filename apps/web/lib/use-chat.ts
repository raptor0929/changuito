'use client';

import { useCallback, useRef, useState } from 'react';

import { applyEvent, endTurn, initialState, omitErrorMessage, sendUser, type ChatState } from './chat-state';
import { notifyHumanRequired, SOLO_HUMANOS } from './human-gate-ui';
import { LOGIN_REQUIRED, LOGIN_REQUIRED_MESSAGE } from './login-constants';
import { parseEvents, type ChatRequest } from './protocol';
import { ensureUserSession } from './session-client';

/**
 * One turn at a time against /api/chat, decoded from SSE.
 *
 * `fetch` rather than EventSource: the turn is a POST with a body, and
 * EventSource can only GET. The cost is doing the frame splitting ourselves,
 * which `parseEvents` handles — a frame can be cut anywhere, including inside
 * a JSON string, so the leftover has to survive to the next chunk.
 *
 * Only one in-flight turn is allowed. A second send is ignored until the user
 * hits Parar (abort) or the stream ends — spam would otherwise pile up on the
 * local model lane and look like "Ollama is broken".
 */
export interface UseChatAuth {
  isAuthenticated?: boolean;
  /** Stellar address once Pollar has a session. Used to mint `chg_user`. */
  address?: string | null;
}

export function useChat(auth?: UseChatAuth) {
  const [state, setState] = useState<ChatState>(initialState);
  const [loginRequired, setLoginRequired] = useState(false);
  // A ref, not state: the snapshot is read inside the send closure and must be
  // the one from the turn that just finished, not the one React rendered with.
  const snapshot = useRef<ChatState['snapshot']>(undefined);
  const sessionId = useRef<string>('');
  const abort = useRef<AbortController | null>(null);
  /** Sync lock — React state alone still lets a double-Enter race a second fetch. */
  const inFlight = useRef(false);
  // Read at send time so a login that landed this render is visible before the
  // latch effect has cleared `loginRequired`.
  const authRef = useRef<UseChatAuth>({});
  authRef.current = auth ?? {};

  const clearLoginRequired = useCallback(() => {
    setLoginRequired(false);
    setState((s) => omitErrorMessage(s, LOGIN_REQUIRED_MESSAGE));
  }, []);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text) return;
    if (inFlight.current) return;
    // The latch blocks guests only. A signed-in shopper keeps sending.
    if (loginRequired && !authRef.current.isAuthenticated) return;
    inFlight.current = true;
    if (authRef.current.isAuthenticated) setLoginRequired(false);

    sessionId.current ||= crypto.randomUUID();

    const run = async (isRetry: boolean): Promise<void> => {
      if (!isRetry) {
        setState((s) => {
          const base = authRef.current.isAuthenticated ? omitErrorMessage(s, LOGIN_REQUIRED_MESSAGE) : s;
          return base.streaming ? base : sendUser(base, text);
        });
      }

      const controller = new AbortController();
      abort.current = controller;
      try {
        const body: ChatRequest = { sessionId: sessionId.current, message: text, snapshot: snapshot.current };
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          credentials: 'same-origin',
        });
        if (!res.ok || !res.body) {
          let message = `El servidor respondió ${res.status}.`;
          try {
            const json = (await res.json()) as { error?: string; message?: string };
            if (json.error === SOLO_HUMANOS) {
              // The gate draws the widget. A red bubble here just invites another send.
              notifyHumanRequired();
              setState((s) => endTurn(s));
              return;
            }
            if (json.error === LOGIN_REQUIRED) {
              if (authRef.current.isAuthenticated) {
                // Pollar can flip before `chg_user` is stored. Mint the cookie
                // and retry once. Do not latch the guest gate or paint its copy.
                const address = authRef.current.address;
                if (controller.signal.aborted) {
                  setState((s) => omitErrorMessage(endTurn(s), LOGIN_REQUIRED_MESSAGE));
                  return;
                }
                if (!isRetry && address) {
                  const ok = await ensureUserSession(address, { force: true });
                  if (controller.signal.aborted) {
                    setState((s) => omitErrorMessage(endTurn(s), LOGIN_REQUIRED_MESSAGE));
                    return;
                  }
                  if (ok) {
                    await run(true);
                    return;
                  }
                }
                setState((s) =>
                  omitErrorMessage(
                    endTurn(s, 'No pude guardar la sesión. Probá de nuevo.'),
                    LOGIN_REQUIRED_MESSAGE,
                  ),
                );
                return;
              }
              setLoginRequired(true);
              setState((s) => endTurn(s, json.message ?? LOGIN_REQUIRED_MESSAGE));
              return;
            }
            if (json.message) message = json.message;
          } catch {
            /* not JSON */
          }
          throw new Error(message);
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let rest = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = parseEvents(rest + value);
          rest = parsed.rest;
          for (const e of parsed.events) {
            if (e.t === 'done') snapshot.current = e.snapshot;
            setState((s) => applyEvent(s, e));
          }
        }
        // The stream ended without a `done`: the route died mid-turn.
        setState((s) => endTurn(s, 'Se cortó la conexión antes de terminar. Probá de nuevo.'));
      } catch (err) {
        if (controller.signal.aborted) {
          setState((s) => endTurn(s));
          return;
        }
        setState((s) => endTurn(s, err instanceof Error ? err.message : 'Algo falló.'));
      }
    };

    try {
      await run(false);
    } finally {
      abort.current = null;
      inFlight.current = false;
    }
  }, [loginRequired]);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  return { state, send, stop, loginRequired, clearLoginRequired };
}
