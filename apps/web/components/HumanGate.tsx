'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** Dev without Turnstile must never sit on "Un segundo…" forever. */
const DEV_FAIL_OPEN_MS = 1500;

/**
 * Wraps the shopper UI. Completes Turnstile once, sets httpOnly cookie via
 * /api/human, then unlocks chat/APIs. Dev without keys: unlock immediately.
 */
export function HumanGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needWidget, setNeedWidget] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const exchange = useCallback(async (token?: string) => {
    const res = await fetch('/api/human', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(token ? { token } : {}),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(json.message ?? 'No pudimos verificar que sos una persona.');
    }
    setReady(true);
    setNeedWidget(false);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Local / no Turnstile: never leave the user on the waiting screen.
    const failOpen = window.setTimeout(() => {
      if (cancelled || SITE_KEY) return;
      console.warn(
        '[changuito] human-gate: timeout sin Turnstile, abriendo el chat igual.',
      );
      setReady(true);
    }, DEV_FAIL_OPEN_MS);

    (async () => {
      try {
        const res = await fetch('/api/human', {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        });
        const json = (await res.json()) as { ok?: boolean; mode?: string };
        if (cancelled) return;

        // Open mode (dev sin keys): unlock YA. Cookie mint is best-effort.
        if (json.mode === 'open') {
          window.clearTimeout(failOpen);
          setReady(true);
          console.warn(
            '[changuito] human-gate abierto en local (sin Turnstile). En producción hace falta NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY.',
          );
          void exchange().catch((err: unknown) => {
            console.warn('[changuito] human-gate cookie mint falló (chat igual abierto):', err);
          });
          return;
        }

        if (json.ok) {
          window.clearTimeout(failOpen);
          setReady(true);
          return;
        }

        if (!SITE_KEY) {
          // Prod-closed without a site key: show error, but failOpen timer still
          // covers hung GETs in local builds that somehow aren't mode=open.
          setError('Falta la verificación humana (Turnstile).');
          return;
        }
        window.clearTimeout(failOpen);
        setNeedWidget(true);
      } catch {
        if (cancelled) return;
        if (!SITE_KEY) {
          // Network blip in local: open chat rather than trap the shopper.
          window.clearTimeout(failOpen);
          setReady(true);
          return;
        }
        setError('No pudimos iniciar la verificación.');
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(failOpen);
    };
  }, [exchange]);

  useEffect(() => {
    if (!needWidget || !SITE_KEY || !host.current) return;

    let cancelled = false;

    const mount = () => {
      if (cancelled || !host.current || !window.turnstile) return;
      if (widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
      widgetId.current = window.turnstile.render(host.current, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        theme: 'light',
        callback: (token) => {
          void exchange(token).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Verificación fallida.');
          });
        },
        'error-callback': () => setError('Turnstile falló. Probá de nuevo.'),
        'expired-callback': () => setError('La verificación expiró. Probá de nuevo.'),
      });
    };

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-chg-turnstile]');
      if (existing) {
        existing.addEventListener('load', mount);
      } else {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.dataset.chgTurnstile = '1';
        s.onload = mount;
        document.head.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
    };
  }, [needWidget, exchange]);

  if (ready) return <>{children}</>;

  return (
    <div className="human-gate" role="status" aria-live="polite">
      <img
        className="human-gate-mascot"
        src="/brand/mascot-idle.png"
        alt=""
        aria-hidden="true"
        width={120}
        height={120}
      />
      <h2>Un segundo…</h2>
      <p>Confirmamos que sos una persona antes de armar el súper.</p>
      {error ? <p className="human-gate-error">{error}</p> : null}
      <div ref={host} className="human-gate-widget" />
    </div>
  );
}
