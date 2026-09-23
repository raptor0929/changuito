'use client';

import { useLayoutEffect } from 'react';

import { keyboardInset, shellFrame } from '../../lib/bug-report/keyboard-inset.ts';

/**
 * Pins /reportarbug to the visual viewport.
 *
 * On iOS the layout viewport stays full height when the keyboard opens and
 * Safari pans it. The autofill pill is positioned against that pan and ends
 * up over the form. Keeping the document still and sizing this page to the
 * visible area (stopping above the pill while the keyboard is open) leaves
 * the pill on the keyboard and the form free to scroll inside the page.
 */
export function BugReportViewport() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const sync = () => {
      const layout = window.innerHeight;
      const visual = vv?.height ?? layout;
      const frame = shellFrame(layout, visual, vv?.offsetTop ?? 0);
      root.style.setProperty('--vvh', `${frame.height}px`);
      root.style.setProperty('--vv-top', `${frame.top}px`);
      // The trust line reads this and drops out while the keys are up,
      // so the form keeps the visible band.
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
