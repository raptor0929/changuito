import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the try CTA uses the locked running mascot instead of an arrow', () => {
  const source = readFileSync(join(root, 'components/landing/try-link.tsx'), 'utf8');
  assert.equal(source.includes('→'), false);
  assert.match(source, /href=\{APP_URL\}/);
  assert.match(source, /\{HERO\.cta\}/);
  assert.match(source, /src="\/brand\/mascota-corriendo\.png"/);
  assert.match(source, /alt=""/);
  assert.match(source, /aria-hidden="true"/);

  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.match(css, /\.ctaMascot\s*\{[^}]*height:\s*1\.4em;/);
  assert.match(css, /\.ctaMascot\s*\{[^}]*object-fit:\s*contain;/);
  assert.equal(css.includes('.ctaArrow'), false);

  const pub = readFileSync(join(root, 'public/brand/mascota-corriendo.png'));
  const locked = readFileSync(join(root, '../branding/mascot/mascota-corriendo.png'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(pub), hash(locked));
});
