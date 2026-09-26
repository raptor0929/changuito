import qr from 'qr.js';

/**
 * A QR code as one SVG path.
 *
 * SVG rather than a canvas: it is crisp at any size a phone is held at, it
 * needs no ref, no effect and no device-pixel-ratio arithmetic, and it renders
 * on the server like the rest of the page. One `<path>` rather than a thousand
 * `<rect>`s because a 37×37 code is 1369 modules, and a DOM node each is a
 * measurable amount of work for a picture that never changes.
 *
 * Pure, and its own module, so the encoding can be tested without a browser.
 */

/**
 * Error correction, not a percentage. `qr.js`'s own wrapper reads
 * `opt.errorCorrectLevel || ErrorCorrectLevel.H`, and its code for **M is 0** —
 * which is falsy, so asking for M silently gets H. Q is 3, so asking for Q
 * gets Q. That is the whole reason this is Q and not the usual M: not a
 * judgement about redundancy, a falsy zero in a library from 2012.
 *
 * Q recovers 25%, which is more than a screen needs, and costs a 37×37 grid
 * for a Stellar address where L would be 33×33. At the size this is drawn the
 * difference is a module three pixels narrower.
 */
const LEVEL_Q = 3;

/**
 * Four modules of white on every side, which the spec requires and scanners
 * genuinely enforce — a code bled to the edge of its box reads as no code at
 * all. It is part of the picture, so it is part of `size` rather than a margin
 * the caller has to remember.
 */
const QUIET = 4;

export interface QrPicture {
  /** The side of the viewBox, in modules, quiet zone included. */
  size: number;
  /** The dark modules, as an SVG path. Empty when the text was empty. */
  d: string;
}

export function qrPicture(text: string): QrPicture {
  // An empty string encodes to a valid code that means nothing, and the
  // callers here are rendering a value that may not have arrived yet.
  if (!text) return { size: QUIET * 2 + 1, d: '' };

  const { modules } = qr(text, { errorCorrectLevel: LEVEL_Q });
  const side = modules.length;
  const parts: string[] = [];

  // Runs, not modules: a row of a QR code is mostly short horizontal stripes,
  // and one subpath per stripe is roughly a third of the nodes of one per
  // module. The subpaths never overlap, so the default fill rule is fine.
  for (let row = 0; row < side; row++) {
    const cells = modules[row]!;
    let start = -1;
    for (let col = 0; col <= side; col++) {
      const dark = col < side && cells[col] === true;
      if (dark && start === -1) start = col;
      if (!dark && start !== -1) {
        const len = col - start;
        parts.push(`M${start + QUIET} ${row + QUIET}h${len}v1h-${len}z`);
        start = -1;
      }
    }
  }

  return { size: side + QUIET * 2, d: parts.join('') };
}
