import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Tab and home-screen icons are a square crop of the locked idle mascot.
 * Source: apps/branding/mascot/mascota-idle.png. Not the Sol de Mayo, and
 * not the discarded éxito pose.
 */

const landing = join(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(landing, '../web');

function pngSize(buf: Buffer): { w: number; h: number } {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function icoSizes(buf: Buffer): number[] {
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  const count = buf.readUInt16LE(4);
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = buf[6 + i * 16];
    sizes.push(w === 0 ? 256 : w);
  }
  return sizes;
}

test('both apps serve the idle mascot as favicon, tab icon, and apple touch icon', () => {
  assert.equal(existsSync(join(landing, 'app/icon.svg')), false);
  assert.equal(existsSync(join(landing, '../branding/mascot/mascota-idle.png')), true);
  assert.equal(existsSync(join(landing, '../branding/mascot/mascota-exito.png')), false);

  for (const name of ['favicon.ico', 'icon.png', 'apple-icon.png'] as const) {
    const a = readFileSync(join(landing, 'app', name));
    const b = readFileSync(join(web, 'app', name));
    assert.ok(a.equals(b), name);
  }

  assert.deepEqual(pngSize(readFileSync(join(landing, 'app/icon.png'))), { w: 32, h: 32 });
  assert.deepEqual(pngSize(readFileSync(join(landing, 'app/apple-icon.png'))), { w: 180, h: 180 });
  assert.deepEqual(icoSizes(readFileSync(join(landing, 'app/favicon.ico'))), [16, 32, 48]);
});
