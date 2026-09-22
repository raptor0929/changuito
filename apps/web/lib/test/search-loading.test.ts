import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The waiting row is the first thing a shopper sees after sending a message.
 * Copy sits on the left; the approved back-and-forth search GIF sits
 * immediately after it. The falling-products GIF and the idle PNG are not
 * the motion source. Idle is only the reduced-motion stand-in.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const branding = join(web, '../branding');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadingBlock(chat: string): string {
  const start = chat.indexOf('data-testid="search-loading"');
  assert.ok(start >= 0, 'search-loading row is missing');
  const end = chat.indexOf(') : null}', start);
  assert.ok(end > start, 'search-loading row does not close');
  return chat.slice(start, end);
}

test('the waiting row is copy then the search GIF', () => {
  const block = loadingBlock(source(join(web, 'components/Chat.tsx')));
  const label = block.indexOf('Buscando en el súper…');
  const motion = block.indexOf('src="/brand/animacion-busqueda.gif"');
  const still = block.indexOf('src="/brand/mascot-idle.png"');

  assert.ok(label >= 0, 'loading copy is missing');
  assert.ok(motion > label, 'search GIF must follow the copy');
  assert.ok(still > motion, 'idle fallback must follow the search GIF');
  assert.equal(block.includes('animacion-cargando'), false);
  assert.match(block, /className="thinking-mascot thinking-mascot-motion"/);
  assert.match(block, /className="thinking-mascot thinking-mascot-still"/);
});

test('reduced motion swaps the search GIF for the idle pose', () => {
  const css = source(join(web, 'app/globals.css'));
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 0, 'prefers-reduced-motion block is missing');
  assert.match(reduced, /\.thinking-mascot-motion\s*\{[^}]*display:\s*none/);
  assert.match(reduced, /\.thinking-mascot-still\s*\{[^}]*display:\s*block/);

  const stillRule = css.slice(css.indexOf('.thinking-mascot-still {'));
  assert.match(stillRule.slice(0, 80), /display:\s*none/);
});

test('the shopper serves the branding search GIF, not a regenerated one', () => {
  const served = readFileSync(join(web, 'public/brand/animacion-busqueda.gif'));
  const master = readFileSync(join(branding, 'motion/animacion-busqueda.gif'));
  assert.equal(createHash('sha256').update(served).digest('hex'), createHash('sha256').update(master).digest('hex'));
  assert.equal(served.subarray(0, 6).toString(), 'GIF89a');
});
