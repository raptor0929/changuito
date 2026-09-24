import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * WCAG 1.4.3 for the colours that are easy to get wrong because they are
 * meant to look faint. The composer placeholder was rgba(espresso, .45),
 * which composites to 2.8:1 on white.
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

test('the composer placeholder clears 4.5:1 on the field and on the page', () => {
  const placeholder = token('placeholder');
  assert.ok(ratio(placeholder, '#ffffff') >= 4.5, `on --surface: ${ratio(placeholder, '#ffffff').toFixed(2)}`);
  assert.ok(ratio(placeholder, token('chg-offwhite')) >= 4.5, `on --bg: ${ratio(placeholder, token('chg-offwhite')).toFixed(2)}`);
});

test('the placeholder rule uses the token, at full opacity', () => {
  const rule = css.slice(css.indexOf('.composer-input::placeholder {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /color:\s*var\(--placeholder\)/);
  // Firefox fades placeholders to .54 by default, which would undo the ratio.
  assert.match(body, /opacity:\s*1/);
});

test('the placeholder still reads lighter than typed text', () => {
  assert.ok(ratio(token('placeholder'), '#ffffff') < ratio(token('chg-espresso'), '#ffffff'));
});

/**
 * The mode chips. Two brand colours plus neutral, and the trap here is that
 * sunflower and arcilla both read as "a colour that means something" while
 * only one of them is safe as a background and neither is safe as text.
 */

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} is not in globals.css`);
  return css.slice(at, css.indexOf('}', at));
}

test('the selected modo real chip is espresso on sunflower, and clears 4.5:1', () => {
  const body = rule(".mode-option[data-mode='mainnet'][aria-checked='true']");
  assert.match(body, /background:\s*var\(--brand\)/);
  assert.match(body, /color:\s*var\(--brand-ink\)/);
  // --brand and --brand-ink are aliases; check what they resolve to.
  assert.match(css, /--brand:\s*var\(--chg-sunflower\)/);
  assert.match(css, /--brand-ink:\s*var\(--chg-espresso\)/);
  const r = ratio(token('chg-espresso'), token('chg-sunflower'));
  assert.ok(r >= 4.5, `espresso on sunflower: ${r.toFixed(2)}`);
});

test('sunflower is never the mode chip text colour', () => {
  for (const sel of ['.mode-option', ".mode-option[aria-checked='true']"]) {
    assert.doesNotMatch(rule(sel), /color:\s*var\(--brand\)/);
  }
});

test('the locked reason uses --warn-ink, which clears 4.5:1 on the wallet card', () => {
  assert.match(rule('.mode-locked'), /color:\s*var\(--warn-ink\)/);
  const ink = token('warn-ink');
  assert.ok(ratio(ink, '#ffffff') >= 4.5, `on --surface: ${ratio(ink, '#ffffff').toFixed(2)}`);
  assert.ok(ratio(ink, token('chg-offwhite')) >= 4.5, `on --bg: ${ratio(ink, token('chg-offwhite')).toFixed(2)}`);
});

test('arcilla is still an accent, not a text colour — which is why --warn-ink exists', () => {
  // If this ever clears 4.5:1 the brand changed, and the two tokens should
  // be reconsidered together rather than one of them quietly deleted.
  assert.ok(ratio(token('chg-arcilla'), token('chg-offwhite')) < 4.5);
});
