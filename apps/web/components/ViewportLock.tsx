'use client';

import { useLayoutEffect } from 'react';

/**
 * Tracks the visual viewport so the shopper shell stays above the keyboard.
 *
 * `dvh` follows the browser chrome, not the keyboard. On iOS the layout
 * viewport stays full height while `visualViewport` shrinks and may shift
 * down. The shell is `position: fixed` to these two variables, so the
 * composer moves with the visible area instead of sitting under the keys.
 */
export function ViewportLock() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const sync = () => {
      const height = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      root.style.setProperty('--vvh', `${Math.round(height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  return null;
}
