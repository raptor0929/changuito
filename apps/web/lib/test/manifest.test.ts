import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import manifest from '../../app/manifest.ts';
import { appContentSecurityPolicy } from '../security-headers.ts';

function pngSize(buf: Buffer): { w: number; h: number } {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('names the app, the icons and a standalone start', () => {
    const doc = manifest();
    assert.equal(doc.name, 'Changuito');
    assert.equal(doc.short_name, 'Changuito');
    assert.equal(doc.start_url, '/');
    assert.equal(doc.display, 'standalone');
    assert.equal(doc.theme_color, '#FAFAF7');
    assert.equal(doc.background_color, '#FAFAF7');
    const icons = doc.icons ?? [];
    assert.ok(icons.some((icon) => icon.sizes === '192x192' && icon.src === '/icons/icon-192.png'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.src === '/icons/icon-512.png'));
  });

  it('ships PNG icons at 192 and 512', () => {
    const icon192 = pngSize(readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url)));
    const icon512 = pngSize(readFileSync(new URL('../../public/icons/icon-512.png', import.meta.url)));
    const mask = pngSize(readFileSync(new URL('../../public/icons/icon-512-maskable.png', import.meta.url)));
    assert.deepEqual(icon192, { w: 192, h: 192 });
    assert.deepEqual(icon512, { w: 512, h: 512 });
    assert.deepEqual(mask, { w: 512, h: 512 });
  });

  it('refuses framing and eval, and names the wallet host', () => {
    const csp = appContentSecurityPolicy('production', { ga: '', meta: '', clarity: '' });
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /sdk\.api\.pollar\.xyz/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.doesNotMatch(csp, /ws:\/\/localhost:\*/);
  });
});
