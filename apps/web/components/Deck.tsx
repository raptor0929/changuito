'use client';

import type { ReactNode } from 'react';

import { CartRail } from './CartRail';
import { HistoryRail } from './HistoryRail';
import { useShop } from './ShopProvider';

/**
 * The three-column window: history, the chat, the basket.
 *
 * `.deck` is `display: contents` below the wide breakpoint, so at phone and
 * tablet width the chat shell is laid out exactly as it was before any of
 * this existed — same `position: fixed`, same centring, same 560px block.
 * That is deliberate: the phone layout is hand-tuned to fit an empty chat in
 * a 360×740 viewport without scrolling, and the cheapest way not to break it
 * is for the wrapper to not be there.
 *
 * Only at the wide breakpoint does `.deck` become the fixed viewport box and
 * the shell un-fix into the middle grid cell. See globals.css.
 *
 * The drawer's open state is in ShopProvider, not here: the button that opens
 * it sits in the masthead, which is inside `children`, so this component is
 * below the two of them rather than above both.
 */
export function Deck({ children }: { children: ReactNode }) {
  const shop = useShop();
  return (
    <div className="deck">
      <HistoryRail open={shop?.historyOpen ?? false} onClose={() => shop?.setHistoryOpen(false)} />
      {children}
      <CartRail />
    </div>
  );
}
