'use client';

import { useLayoutEffect } from 'react';

import { keyboardInset, shellFrame } from '../../lib/bug-report/keyboard-inset.ts';

/**
 * Pins /whitelist to the visual viewport.
 *
 * Same shell as /reportarbug. On iOS the layout viewport stays full height
 * when the keyboard opens and Safari pans the document. Keeping the document
 * still and sizing this page to the visible area lets the form scroll inside
 * the page instead of under the keys. The trust line reads data-keyboard and
 * drops out while the keys are up.
 */
export function WhitelistViewport() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const sync = () => {
      const layout = window.innerHeight;
      const visual = vv?.height ?? layout;
      const frame = shellFrame(layout, visual, vv?.offsetTop ?? 0);
      root.style.setProperty('--vvh', `${frame.height}px`);
      root.style.setProperty('--vv-top', `${frame.top}px`);
      if (keyboardInset(layout, visual) > 0) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-top');
      delete root.dataset.keyboard;
    };
  }, []);

  return null;
}
