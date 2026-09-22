import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');

function block(selector: string, from = 0): string {
  const start = css.indexOf(selector, from);
  assert.notEqual(start, -1, selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

test('desktop hero keeps the mascot on the action-row baseline', () => {
  const hero = block('.heroInner {');
  assert.match(hero, /align-items:\s*end/);
  assert.match(hero, /padding:\s*48px 24px 24px/);
  assert.equal(hero.includes('80px'), false);
  const frame = block('.mascotFrame {');
  assert.match(frame, /justify-self:\s*start/);
  assert.match(frame, /justify-content:\s*flex-start/);
  const still = block('.mascotFrame .mascotStill {');
  assert.match(still, /max-height:\s*300px/);
});

test('mobile keeps the mascot tight under the try button', () => {
  const narrow = css.indexOf('@media (max-width: 480px)');
  assert.notEqual(narrow, -1);
  const hero = block('.heroInner {', narrow);
  assert.match(hero, /gap:\s*0/);
  assert.match(hero, /padding:\s*8px 16px 12px/);
  const frame = block('.mascotFrame {', narrow);
  assert.match(frame, /margin:\s*0 auto/);
  const media = css.slice(narrow);
  assert.match(media, /max-height:\s*200px/);
});
