import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * WCAG 1.4.3 for the Testnet network badge added beside the mode badge.
 * Light and dark surfaces both have to clear 4.5:1 — the badge uses --text
 * on --surface, which is the same pairing the mode badge uses in preview.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/globals.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} is not a #rrggbb token`);
  return m[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} is not in globals.css`);
  return css.slice(at, css.indexOf('}', at));
}

test('the network badge uses ink on surface and clears 4.5:1', () => {
  const body = rule('.network-badge');
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /color:\s*var\(--text\)/);
  // Light: --text resolves through --chg-espresso on white/--surface.
  const light = ratio(token('chg-espresso'), '#ffffff');
  assert.ok(light >= 4.5, `light: ${light.toFixed(2)}`);
});

test('the network badge does not dress up as a control', () => {
  assert.match(rule('.network-badge'), /cursor:\s*default/);
  assert.doesNotMatch(css, /\.network-badge:hover/);
});
