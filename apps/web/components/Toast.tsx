'use client';

import { useEffect } from 'react';

/**
 * A short-lived message that floats over everything, dialogs included, and
 * goes away by itself. For outcomes the shopper should notice but not have to
 * dismiss: "guardado", "no pudimos guardar". An error is `role="alert"` so a
 * screen reader says it at once; a success is a polite `status`.
 *
 * Fixed, so it escapes the dialog's scroll box, and keyed by the caller: the
 * same text twice in a row is a new toast only if the caller remounts it.
 */
export function Toast({
  message,
  tone = 'ok',
  onDone,
  ms = 5000,
}: {
  message: string;
  tone?: 'ok' | 'error';
  onDone: () => void;
  ms?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);
  return (
    <p className={tone === 'error' ? 'toast is-error' : 'toast'} role={tone === 'error' ? 'alert' : 'status'} data-testid="toast">
      {message}
    </p>
  );
}
