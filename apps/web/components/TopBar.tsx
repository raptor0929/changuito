import type { ReactNode } from 'react';

import { HistoryToggle } from './HistoryToggle';
import { WalletWidget } from './WalletWidget';

/**
 * The sunflower bar across the top of the page: the history toggle and the
 * wordmark on the left, the wallet on the right (Cargar USDC, balance,
 * profile — WalletWidget.tsx).
 *
 * Full width and fixed, outside `.shell` and `.deck`, which are offset by
 * `--topbar-h` so nothing scrolls under it. Sunflower is a background here,
 * so everything on it is espresso — brand manual §14: espresso text on
 * sunflower, never sunflower on sunflower — which is why the bar has its own
 * button style instead of the sunflower `.btn`.
 *
 * A server component holding client ones: the wordmark's `h1` is plain markup
 * and does not need to ship as JavaScript.
 */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        {/* First, so a keyboard lands on the way into the history before
            anything else. Renders nothing at the wide breakpoint, where the
            rail is already a column. */}
        <HistoryToggle />
        {/* The name is text, not only an alt: tools that read a heading's
            text content (crawlers, some audits) saw an empty h1. The image is
            then decorative, so it is not read twice. */}
        <h1 className="brand-name">
          <span className="sr-only">Changuito</span>
          <img
            className="brand-wordmark"
            src="/brand/wordmark.png"
            alt=""
            aria-hidden="true"
            width={1097}
            height={249}
          />
        </h1>
      </div>
      {children ?? <WalletWidget />}
    </header>
  );
}
