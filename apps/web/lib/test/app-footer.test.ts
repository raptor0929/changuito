import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string): string {
  return readFileSync(join(web, path), 'utf8');
}

test('the shopper footer names the makers and the bug report', () => {
  const footer = source('components/AppFooter.tsx');

  assert.match(footer, /© 2026 Changuito® · Hecho en 🇦🇷 por/);
  assert.equal(/© 2026 Changuito(?!®)/.test(footer), false);
  assert.match(footer, /https:\/\/www\.linkedin\.com\/in\/simonethg\//);
  assert.match(footer, /SimonethG/);
  assert.match(footer, /https:\/\/www\.linkedin\.com\/in\/fabio-laura-yavi\//);
  assert.match(footer, />\s*Fabio\s*</);
  assert.match(footer, /https:\/\/www\.changuito\.me\/reportarbug/);
  assert.match(footer, /Reportar un bug/);
  assert.match(footer, /https:\/\/www\.changuito\.me\//);
  assert.match(footer, /www\.changuito\.me/);
  assert.match(footer, /target="_blank"/);
  assert.match(footer, /rel="noopener noreferrer"/);
  assert.equal(footer.includes('app.changuito.me'), false);
  assert.equal(footer.includes('x.com'), false);
  assert.equal(footer.includes('instagram.com'), false);
  assert.equal(footer.includes('\u2014'), false);
  assert.equal(footer.includes('\u2013'), false);
});

test('the footer sits above the composer, not inside the thread', () => {
  const chat = source('components/Chat.tsx');
  const thread = chat.indexOf('data-testid="chat-thread"');
  const footer = chat.indexOf('<AppFooter />');
  const composer = chat.indexOf('className="composer"');

  assert.ok(thread !== -1 && footer > thread && footer < composer);
  assert.equal(chat.includes('ReportBug'), false);

  const gate = source('components/HumanGate.tsx');
  assert.equal(gate.includes('ReportBug'), false);
  assert.ok(gate.indexOf('<AppFooter />') > gate.indexOf('className="human-gate"'));
});
