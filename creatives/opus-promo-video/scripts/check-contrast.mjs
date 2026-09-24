#!/usr/bin/env node
/**
 * WCAG 2.1 contrast check (SC 1.4.3) for every text/background pair the promo
 * puts on screen. A video cannot be scanned with axe-core, so the pairs are
 * listed here explicitly and the script fails if any drops below its target.
 *
 *   node scripts/check-contrast.mjs
 *
 * Canvas is 1080 px wide and is shown full-width on a phone (~390 CSS px), so
 * on-screen size is ~0.36× the source size. All copy is ≥ 28 px source and
 * bold, but only headline-sized text (≥ 66 px source ≈ 24 CSS px) is treated
 * as "large"; everything else is held to the 4.5:1 normal-text threshold.
 */

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Composite an rgba foreground over an opaque background. */
const over = (fg, alpha, bg) =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const luminance = ([r, g, b]) => {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const C = {
  espresso: hex("#2A1A14"),
  sunflower: hex("#F4B942"),
  arcilla: hex("#E07A5F"),
  offWhite: hex("#FAFAF7"),
  white: hex("#FFFFFF"),
  crema: hex("#F5ECE0"),
  muted: hex("#4A332C"),
};

const pairs = [
  {
    where: "Hook/Problema headlines",
    fg: C.offWhite,
    bg: C.espresso,
    large: true,
  },
  {
    where: "Highlight box: arcilla",
    fg: C.espresso,
    bg: C.arcilla,
    large: true,
  },
  {
    where: "Highlight box: sunflower",
    fg: C.espresso,
    bg: C.sunflower,
    large: true,
  },
  {
    where: "Highlight box: espresso",
    fg: C.sunflower,
    bg: C.espresso,
    large: true,
  },
  {
    where: "Promesa sub-copy on sunflower",
    fg: C.espresso,
    bg: C.sunflower,
    large: false,
  },
  {
    where: "Light scenes body copy",
    fg: C.espresso,
    bg: C.offWhite,
    large: false,
  },
  {
    where: "Confirmá scene on crema",
    fg: C.espresso,
    bg: C.crema,
    large: false,
  },
  { where: "Card copy on white", fg: C.espresso, bg: C.white, large: false },
  { where: "Muted card copy on white", fg: C.muted, bg: C.white, large: false },
  {
    where: "Muted CTA footnote on off-white",
    fg: C.muted,
    bg: C.offWhite,
    large: false,
  },
  { where: "User chat bubble", fg: C.offWhite, bg: C.espresso, large: false },
  {
    where: "Step tag on espresso",
    fg: C.offWhite,
    bg: C.espresso,
    large: false,
  },
  { where: "Step tag number", fg: C.espresso, bg: C.sunflower, large: false },
  {
    where: "Glass pill on espresso",
    fg: C.offWhite,
    bg: over(C.offWhite, 0.1, C.espresso),
    large: false,
  },
  {
    where: "Item counter on arcilla",
    fg: C.espresso,
    bg: C.arcilla,
    large: false,
  },
  // Rows that lose to the best price fade once it is picked; 65% still clears AA.
  {
    where: "De-emphasised price rows",
    fg: over(C.espresso, 0.65, C.white),
    bg: C.white,
    large: false,
  },
];

let failures = 0;
for (const p of pairs) {
  const r = ratio(p.fg, p.bg);
  const target = p.large ? 3 : 4.5;
  const pass = r >= target;
  if (!pass) failures++;
  const tag = pass ? "PASS" : "FAIL";
  console.log(
    `${tag}  ${r.toFixed(2).padStart(5)}:1  (≥${target})  ${p.where}`,
  );
}
if (failures) {
  console.error(`\n${failures} pair(s) below WCAG AA.`);
  process.exit(1);
}
