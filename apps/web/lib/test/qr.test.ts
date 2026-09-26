import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import qr from 'qr.js';

import { qrPicture } from '../qr.ts';

/** A real Stellar address: 56 characters, base32, its own CRC16 at the end. */
const ADDRESS = 'GDVSFA5SYQ2K7PUQ5JXKYL4XHHHM2A7T3ZTPXYQWFZGDIZ3ZHFHMNEZK';

/** Every `M<x> <y>h<len>` in the path, as numbers. */
function runs(d: string): { x: number; y: number; len: number }[] {
  return [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    len: Number(m[3]),
  }));
}

describe('qrPicture', () => {
  it('encodes an address at the version its length needs', () => {
    // 56 bytes at level Q is version 5 — 37 modules — plus 4 of quiet zone on
    // each side. Pinned because the level is chosen around a falsy-zero bug in
    // qr.js (see lib/qr.ts), and a well-meant change to M would silently get H
    // and a 41-module grid instead.
    const { size, d } = qrPicture(ADDRESS);
    assert.equal(size, 37 + 8);
    assert.ok(d.length > 0);
  });

  it('RULE: the quiet zone is inside the picture, not left to the caller', () => {
    // A code bled to the edge of its box does not scan at all, so the margin
    // cannot be something a component remembers to add.
    const { size, d } = qrPicture(ADDRESS);
    const all = runs(d);
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.len));
    const maxY = Math.max(...all.map((r) => r.y));

    assert.equal(minX, 4);
    assert.equal(minY, 4);
    assert.equal(maxX, size - 4);
    assert.equal(maxY, size - 4 - 1);
  });

  it('RULE: the path says exactly what the encoder said', () => {
    // The one test that matters, because everything else about this module is
    // qr.js's business. Parse the path back into a matrix and compare it to the
    // encoder's own output: a run merged one module short, an off-by-one in the
    // quiet-zone offset, a row transposed for a column — none of those change
    // the size or the finder patterns, and all of them produce a picture that
    // does not scan.
    const { size, d } = qrPicture(ADDRESS);
    const drawn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    for (const { x, y, len } of runs(d)) {
      for (let i = 0; i < len; i++) drawn[y]![x + i] = true;
    }

    const { modules } = qr(ADDRESS, { errorCorrectLevel: 3 });
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const inCode = row >= 4 && col >= 4 && row < size - 4 && col < size - 4;
        const expected = inCode ? modules[row - 4]![col - 4] === true : false;
        assert.equal(drawn[row]![col], expected, `module ${row},${col}`);
      }
    }
  });

  it('draws the three finder patterns, which is what a scanner looks for first', () => {
    // The top-left finder is a 7×7 ring: its first and last rows are a run of
    // 7, and the rows between are 1 + 1 at each end of it.
    const { size, d } = qrPicture(ADDRESS);
    const all = runs(d);
    const has = (x: number, y: number, len: number) =>
      all.some((r) => r.x === x && r.y === y && r.len === len);

    assert.ok(has(4, 4, 7), 'top-left finder, first row');
    assert.ok(has(4, 10, 7), 'top-left finder, last row');
    assert.ok(has(size - 11, 4, 7), 'top-right finder');
    assert.ok(has(4, size - 11, 7), 'bottom-left finder');
  });

  it('merges a row into runs rather than one subpath per module', () => {
    // The point of the run loop. A finder row is seven dark modules and has to
    // be one `h7`, not seven `h1`s.
    const all = runs(qrPicture(ADDRESS).d);
    const wide = all.filter((r) => r.len >= 7);
    assert.ok(wide.length >= 6, `expected merged runs, got ${JSON.stringify(all.slice(0, 8))}`);
  });

  it('is deterministic, so the same address always draws the same picture', () => {
    assert.equal(qrPicture(ADDRESS).d, qrPicture(ADDRESS).d);
  });

  it('a different address draws a different picture', () => {
    const other = `GA${ADDRESS.slice(2)}`;
    assert.notEqual(qrPicture(ADDRESS).d, qrPicture(other).d);
  });

  it('draws nothing for an empty value instead of a code that means nothing', () => {
    // The address can be null for a frame while the wallet reports in.
    assert.deepEqual(qrPicture(''), { size: 9, d: '' });
  });
});
