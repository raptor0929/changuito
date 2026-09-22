import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACCESSORY_PX,
  KEYBOARD_MIN_PX,
  keyboardInset,
  scrollDeltaToClear,
  shellFrame,
} from '../bug-report/keyboard-inset.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('keyboard inset is the key overlap plus the autofill accessory', () => {
  assert.equal(keyboardInset(800, 470), 800 - 470 + ACCESSORY_PX);
  assert.equal(keyboardInset(844, 844), 0);
  assert.equal(keyboardInset(844, 844 - (KEYBOARD_MIN_PX - 1)), 0);
  assert.equal(keyboardInset(844, 900), 0);
  assert.equal(keyboardInset(Number.NaN, 400), 0);
  assert.equal(keyboardInset(800, Number.POSITIVE_INFINITY), 0);
});

test('the shell tracks the visual viewport and stops above the autofill pill', () => {
  assert.deepEqual(shellFrame(844, 844, 0), { top: 0, height: 844 });
  assert.deepEqual(shellFrame(844, 820, 0), { top: 0, height: 820 });
  assert.deepEqual(shellFrame(844, 500, 24), { top: 24, height: 500 - ACCESSORY_PX });
  assert.deepEqual(shellFrame(800, 0, 10), { top: 10, height: 0 });
  assert.deepEqual(shellFrame(800, 400, Number.NaN), { top: 0, height: 400 - ACCESSORY_PX });
});

test('scroll delta clears the accessory band and keeps a tall field top-aligned', () => {
  assert.equal(scrollDeltaToClear(40, 80, 12, 400), 0);
  assert.equal(scrollDeltaToClear(360, 80, 12, 400), 40);
  assert.equal(scrollDeltaToClear(0, 40, 12, 400), -12);
  assert.equal(scrollDeltaToClear(80, 500, 12, 400), 68);
  assert.equal(scrollDeltaToClear(10, 20, 40, 40), 0);
  assert.equal(scrollDeltaToClear(Number.NaN, 20, 0, 100), 0);
});

test('the bug report page does not use the layout that detaches the iOS autofill bar', () => {
  const css = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');
  const globals = readFileSync(join(root, 'app/globals.css'), 'utf8');
  const page = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const form = readFileSync(join(root, 'components/bug-report/bug-report-form.tsx'), 'utf8');

  assert.equal(/\btransform\s*:/.test(css), false);
  assert.equal(/\bfilter\s*:/.test(css), false);
  assert.equal(/\bperspective\s*:/.test(css), false);
  assert.equal(/\bwill-change\s*:/.test(css), false);
  assert.equal(css.includes('100dvh'), false);
  assert.equal(css.includes('100vh'), false);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /top:\s*var\(--vv-top, 0px\)/);
  assert.match(css, /height:\s*var\(--vvh, 100svh\)/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /scroll-margin-bottom:\s*80px/);
  assert.match(globals, /html:has\(\[data-testid='bug-report-screen'\]\) body/);
  assert.match(globals, /overflow:\s*hidden/);
  assert.match(globals, /scroll-behavior:\s*auto/);
  assert.match(page, /interactiveWidget:\s*'resizes-content'/);
  assert.match(page, /BugReportViewport/);
  assert.match(form, /scrollDeltaToClear/);
  assert.match(form, /bug-report-screen/);
  assert.equal(page.includes('\u2014'), false);
  assert.equal(page.includes('\u2013'), false);
  assert.equal(form.includes('\u2014'), false);
  assert.equal(css.includes('\u2014'), false);
  assert.equal(css.includes('\u2013'), false);
});
