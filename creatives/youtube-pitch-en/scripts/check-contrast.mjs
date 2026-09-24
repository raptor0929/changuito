#!/usr/bin/env node
/**
 * WCAG 2.1 SC 1.4.3 for the text/background pairs in this film.
 * A rendered video cannot be scanned with axe-core, so the pairs are listed
 * here and the script fails if any ratio drops below its target.
 */

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

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
  muted: hex("#4A332C"),
};

const pairs = [
  { where: "Off-white on espresso", fg: C.offWhite, bg: C.espresso, large: true },
  { where: "Espresso on sunflower", fg: C.espresso, bg: C.sunflower, large: false },
  { where: "Espresso on arcilla", fg: C.espresso, bg: C.arcilla, large: true },
  { where: "Sunflower on espresso", fg: C.sunflower, bg: C.espresso, large: true },
  { where: "Espresso on off-white", fg: C.espresso, bg: C.offWhite, large: false },
  { where: "Muted on off-white", fg: C.muted, bg: C.offWhite, large: false },
  { where: "Espresso on white", fg: C.espresso, bg: C.white, large: false },
  { where: "Muted on white", fg: C.muted, bg: C.white, large: false },
  { where: "Off-white on espresso body", fg: C.offWhite, bg: C.espresso, large: false },
];

let failed = 0;
for (const pair of pairs) {
  const r = ratio(pair.fg, pair.bg);
  const need = pair.large ? 3 : 4.5;
  const ok = r + 1e-6 >= need;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "ok " : "FAIL"} ${r.toFixed(2)}:1 (need ${need})  ${pair.where}`,
  );
}

if (failed) {
  console.error(`${failed} pair(s) below WCAG AA`);
  process.exit(1);
}
