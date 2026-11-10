import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { uiCopy } from '../ui-copy.ts';

/**
 * The phone composer (<=560px). iOS Safari sizes an empty textarea to one
 * line, ignoring rows=2 and the placeholder, so a two-line placeholder was
 * cut in half. The field stays one line (no taller bar); instead every phone
 * placeholder fits one line at 360px, in a 14px placeholder (typed text stays
 * 16px so iOS does not zoom). Desktop is untouched.
 */
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf('}', at));
}

describe('phone composer', () => {
  it('the empty-chat field stays one line tall at 16px', () => {
    const body = rule('  .shell:has(.chat.is-empty) .composer-input');
    assert.match(body, /min-height: 44px;/);
    assert.match(body, /font-size: 16px;/);
    assert.doesNotMatch(body, /calc\(/);
  });

  it('the in-conversation field keeps its old one-line floor', () => {
    const at = css.indexOf('A long placeholder must not inflate the bar');
    assert.match(css.slice(at, at + 500), /\.composer-input \{\s*min-height: 48px;\s*max-height: 96px;/);
  });

  it('only the placeholder is smaller on phones, and never below 14px', () => {
    assert.match(css, /@media \(max-width: 560px\) \{\s*\.composer-input::placeholder \{ font-size: 14px; \}\s*\}/);
  });

  it('the empty bar is no taller than before: 16px of vertical space, rows clear the focus ring', () => {
    const body = rule('  .shell:has(.chat.is-empty) .composer');
    assert.match(body, /row-gap: 6px;/);
    assert.match(body, /padding: 5px 8px;/);
  });

  it('Enviar is centred beside the field and the tools have an even gap', () => {
    const at = css.indexOf('A long placeholder must not inflate the bar');
    const block = css.slice(at, at + 800);
    assert.match(block, /\.composer > \.btn \{ align-self: center; \}/);
    assert.match(block, /\.composer-tools \{ gap: 8px; \}/);
    assert.doesNotMatch(block, /\.composer \{ row-gap/);
  });

  it('the home-indicator inset stays on the footer under the composer', () => {
    assert.match(css, /\.shell:has\(\.chat\.is-empty\) \.app-footer \{\s*padding: 0 8px calc\(4px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });

  it('desktop keeps its composer as before', () => {
    assert.match(css, /@media \(min-width: 561px\) \{\s*\.composer-input \{ min-height: 72px; \}/);
    const base = css.slice(css.indexOf('\n.composer {'));
    assert.match(base.slice(0, base.indexOf('}')), /row-gap: 6px;[\s\S]*padding: 10px 8px;/);
  });

  it('phone placeholders are short enough for one line at 360px (measured in WebKit at 14px)', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const p of uiCopy(lang).chat.placeholders) assert.ok(p.short.length <= 28, `${lang}: ${p.short}`);
    }
    assert.deepEqual(
      uiCopy('es').chat.placeholders.map((p) => p.short),
      ['¿Qué necesitás del súper?', '¿Asado o algo light?', '¿Qué cocinás y para cuántos?', '¿Semana laboral o juntada?'],
    );
    assert.deepEqual(
      uiCopy('en').chat.placeholders.map((p) => p.short),
      ['What do you need today?', 'A roast or something light?', 'Cooking what, for how many?', 'Work week or get-together?'],
    );
  });
});
