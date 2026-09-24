import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import {
  codeDigitLabel,
  POLLAR_ATTR_ES,
  POLLAR_TEXT_ES,
  translatePollarAttr,
  translatePollarText,
} from '../pollar-es.ts';

describe('translatePollarText', () => {
  it('translates the strings QA read in the login modal', () => {
    assert.equal(translatePollarText('Log in or sign up'), 'Ingresá o creá tu cuenta');
    assert.equal(translatePollarText('Submit'), 'Continuar');
  });

  it('keeps the space that separates a sentence from the email after it', () => {
    assert.equal(
      translatePollarText('Enter the 6-digit code sent to '),
      'Ingresá el código de 6 dígitos que mandamos a ',
    );
  });

  it('leaves anything it does not know exactly as it was', () => {
    assert.equal(translatePollarText('Log in or sign up now'), null);
    assert.equal(translatePollarText('vos@example.com'), null);
    assert.equal(translatePollarText('   '), null);
  });

  it('settles: a translation is not itself translatable', () => {
    // The observer re-runs on its own writes. This is what stops that looping.
    for (const es of Object.values(POLLAR_TEXT_ES)) assert.equal(translatePollarText(es), null);
    for (const [name, map] of Object.entries(POLLAR_ATTR_ES)) {
      for (const es of Object.values(map)) assert.equal(translatePollarAttr(name, es), null);
    }
  });

  it('names each box of the email code for a screen reader', () => {
    assert.equal(codeDigitLabel(0, 6), 'Dígito 1 de 6 del código');
    assert.equal(codeDigitLabel(5, 6), 'Dígito 6 de 6 del código');
  });

  it('only rewrites attributes it owns', () => {
    assert.equal(translatePollarAttr('aria-label', 'Close'), 'Cerrar');
    assert.equal(translatePollarAttr('placeholder', 'you@email.com'), 'tu@email.com');
    assert.equal(translatePollarAttr('title', 'Close'), null);
  });
});

describe('the installed @pollar/react', () => {
  // If Pollar rewords a string, the modal quietly goes back to English. This
  // is where that shows up instead: the upgrade PR fails here.
  const require = createRequire(import.meta.url);
  const bundle = readFileSync(require.resolve('@pollar/react'), 'utf8');
  const present = (s: string) =>
    bundle.includes(JSON.stringify(s)) ||
    bundle.includes(s) ||
    bundle.includes(JSON.stringify(s).replace(/[\u2014\u2026]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

  it('still renders every string we translate', () => {
    const missing = Object.keys(POLLAR_TEXT_ES).filter((s) => !present(s));
    assert.deepEqual(missing, []);
  });

  it('still uses the attributes we translate', () => {
    for (const map of Object.values(POLLAR_ATTR_ES)) {
      for (const s of Object.keys(map)) assert.ok(present(s), s);
    }
  });
});
