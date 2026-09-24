#!/usr/bin/env node
/**
 * Renders the review stills into out/frames/.
 * Frame numbers are absolute on the 1920×1080 timeline.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out", "frames");
mkdirSync(OUT, { recursive: true });

const FRAMES = [
  ["01-title", 100],
  ["02-insight", 360],
  ["03-promise", 600],
  ["04-demo-chat", 860],
  ["05-demo-prices", 1140],
  ["06-demo-cart", 1460],
  ["07-pay-stellar", 1600],
  ["08-pay-wallet", 1740],
  ["09-pay-fund", 1860],
  ["10-pay-card", 2040],
  ["11-pay-discard", 2140],
  ["11b-pay-your-card", 2200],
  ["12-pay-why", 2260],
  ["13-cta", 2480],
];

for (const [name, frame] of FRAMES) {
  const dest = join(OUT, `${name}.png`);
  execFileSync(
    "npx",
    ["remotion", "still", "YouTubePitch", dest, `--frame=${frame}`],
    { cwd: ROOT, stdio: "inherit" },
  );
}

console.log(`Wrote ${FRAMES.length} stills to ${OUT}`);
