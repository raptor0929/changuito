'use client';

import { useCallback, useRef, useState } from 'react';

import { applyEvent, endTurn, initialState, sendUser, type ChatState } from './chat-state';
import { parseEvents, type ChatRequest } from './protocol';

/**
 * One turn at a time against /api/chat, decoded from SSE.
 *
 * `fetch` rather than EventSource: the turn is a POST with a body, and
 * EventSource can only GET. The cost is doing the frame splitting ourselves,
 * which `parseEvents` handles — a frame can be cut anywhere, including inside
 * a JSON string, so the leftover has to survive to the next chunk.
 */
export function useChat() {
  const [state, setState] = useState<ChatState>(initialState);
  // A ref, not state: the snapshot is read inside the send closure and must be
  // the one from the turn that just finished, not the one React rendered with.
  const snapshot = useRef<ChatState['snapshot']>(undefined);
  const sessionId = useRef<string>('');
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text) return;
    sessionId.current ||= crypto.randomUUID();
    setState((s) => (s.streaming ? s : sendUser(s, text)));

    const controller = new AbortController();
    abort.current = controller;
    try {
      const body: ChatRequest = { sessionId: sessionId.current, message: text, snapshot: snapshot.current };
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`El servidor respondió ${res.status}.`);
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
    }
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);

  return { state, send, stop };
}
