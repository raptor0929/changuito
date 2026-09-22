'use client';

import { useCallback, useRef, useState } from 'react';

import { applyEvent, endTurn, initialState, sendUser, type ChatState } from './chat-state';
import { LOGIN_REQUIRED, LOGIN_REQUIRED_MESSAGE } from './login-constants';
import { parseEvents, type ChatRequest } from './protocol';

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
export function useChat() {
  const [state, setState] = useState<ChatState>(initialState);
  const [loginRequired, setLoginRequired] = useState(false);
  // A ref, not state: the snapshot is read inside the send closure and must be
  // the one from the turn that just finished, not the one React rendered with.
  const snapshot = useRef<ChatState['snapshot']>(undefined);
  const sessionId = useRef<string>('');
  const abort = useRef<AbortController | null>(null);
  /** Sync lock — React state alone still lets a double-Enter race a second fetch. */
  const inFlight = useRef(false);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text) return;
    if (loginRequired) return;
    if (inFlight.current) return;
    inFlight.current = true;

    sessionId.current ||= crypto.randomUUID();
    setState((s) => (s.streaming ? s : sendUser(s, text)));

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
          if (json.error === LOGIN_REQUIRED) {
            setLoginRequired(true);
            message = json.message ?? LOGIN_REQUIRED_MESSAGE;
          } else if (json.message) {
            message = json.message;
          }
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
    } finally {
      abort.current = null;
      inFlight.current = false;
    }
  }, [loginRequired]);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const clearLoginRequired = useCallback(() => setLoginRequired(false), []);

  return { state, send, stop, loginRequired, clearLoginRequired };
}
