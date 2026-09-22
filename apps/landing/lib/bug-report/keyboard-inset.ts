/**
 * Space the bug-report page keeps clear of the iOS keyboard.
 *
 * Safari overlays the keyboard on the layout viewport. `visualViewport`
 * shrinks to the keys, but the autofill accessory (the passwords / cards /
 * location pill) is drawn inside that viewport, on top of the page. Callers
 * add `ACCESSORY_PX` on top of the key overlap so a focused field can sit
 * above the pill, and so the page can scroll the rest of the form there.
 *
 * Small overlaps are the URL bar, not the keyboard. Those stay at 0 so the
 * resting layout does not grow while the user is just scrolling.
 */

export const KEYBOARD_MIN_PX = 150;
export const ACCESSORY_PX = 72;

export function keyboardInset(layoutHeight: number, visualHeight: number): number {
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visualHeight)) return 0;
  const overlap = Math.round(layoutHeight - visualHeight);
  if (overlap < KEYBOARD_MIN_PX) return 0;
  return overlap + ACCESSORY_PX;
}

/**
 * Frame for the fixed bug-report shell, in CSS pixels.
 * `top` follows the visual viewport pan. While the keyboard is open the
 * height stops above the autofill pill, which Safari draws inside the
 * visual viewport rather than above the keys.
 */
export function shellFrame(
  layoutHeight: number,
  visualHeight: number,
  offsetTop: number,
): { top: number; height: number } {
  const top = Number.isFinite(offsetTop) ? Math.max(0, Math.round(offsetTop)) : 0;
  if (!Number.isFinite(visualHeight) || visualHeight <= 0) return { top, height: 0 };
  const visual = Math.round(visualHeight);
  const keyboardOpen = keyboardInset(layoutHeight, visualHeight) > 0;
  return { top, height: keyboardOpen ? Math.max(0, visual - ACCESSORY_PX) : visual };
}

/**
 * How far to scroll so `rect` lands inside [visibleTop, visibleBottom].
 * A field taller than that band keeps its top in view.
 * Negative scrolls up. Zero means the field is already clear.
 */
export function scrollDeltaToClear(
  rectTop: number,
  rectHeight: number,
  visibleTop: number,
  visibleBottom: number,
): number {
  if (!Number.isFinite(rectTop) || !Number.isFinite(rectHeight)) return 0;
  if (!Number.isFinite(visibleTop) || !Number.isFinite(visibleBottom)) return 0;
  if (visibleBottom <= visibleTop) return 0;
  const visibleHeight = visibleBottom - visibleTop;
  const rectBottom = rectTop + rectHeight;
  if (rectHeight >= visibleHeight - 1) return rectTop - visibleTop;
  if (rectBottom > visibleBottom) return rectBottom - visibleBottom;
  if (rectTop < visibleTop) return rectTop - visibleTop;
  return 0;
}
