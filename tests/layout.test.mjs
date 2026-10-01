import test from 'node:test';
import assert from 'node:assert/strict';
import { regions, layoutChoices, isWipe, assignSource } from '../src/layout.js';
import { planeFormat, colorParameters } from '../src/renderer.js';
const split = { x: .3, x2: .7, y: .4, y2: .8 };
test('layouts partition their cells without overlap; wipes cover the full canvas', () => {
  for (let count = 2; count <= 9; count++) for (const [mode] of layoutChoices(count)) {
    const list = regions(count, mode, 1200, 900, split);
    assert.equal(list.length, count);
    const fraction = mode === 'grid' && count !== 4 ? count / (Math.min(3, count) * Math.ceil(count / Math.min(3, count))) : 1;
    assert.ok(Math.abs(list.reduce((area, { clip }) => area + clip.w * clip.h, 0) - 1200 * 900 * fraction) < .0001);
    for (const a of list) {
      if (isWipe(mode)) assert.deepEqual(a.viewport, { x: 0, y: 0, w: 1200, h: 900 });
      for (const b of list) if (a !== b) {
        const overlap = Math.max(0, Math.min(a.clip.x + a.clip.w, b.clip.x + b.clip.w) - Math.max(a.clip.x, b.clip.x)) * Math.max(0, Math.min(a.clip.y + a.clip.h, b.clip.y + b.clip.h) - Math.max(a.clip.y, b.clip.y));
        assert.ok(overlap < .0001);
      }
    }
  }
});
test('changing source swaps assignments instead of duplicating sessions', () => {
  assert.deepEqual(assignSource([0, 1, 2, 3], 0, 2), [2, 1, 0, 3]);
});
test('plane geometry supports odd sizes, 4:2:0/4:2:2/4:4:4, NV12 and high bit depth', () => {
  assert.deepEqual(planeFormat('I420', 7, 5).sizes, [[7, 5, 1], [4, 3, 1], [4, 3, 1]]);
  assert.deepEqual(planeFormat('I422P10', 8, 6).sizes, [[8, 6, 1], [4, 6, 1], [4, 6, 1]]);
  assert.equal(planeFormat('I444P12', 8, 6).bits, 12);
  assert.equal(planeFormat('NV12', 8, 6).interleaved, true);
  assert.equal(planeFormat('RGBA', 8, 6), null);
});
test('YUV ranges use exact 8/10/12-bit chroma midpoints, not 0.5', () => {
  for (const bits of [8, 10, 12]) {
    const max = 2 ** bits - 1, scale = 2 ** (bits - 8);
    const limited = colorParameters({ matrix: 'bt709', fullRange: false }, bits, 1080);
    assert.equal(limited.range[0], 16 * scale / max);
    assert.ok(Math.abs((235 * scale / max - limited.range[0]) * limited.range[1] - 1) < 1e-12);
    assert.equal(limited.range[2], 2 ** (bits - 1) / max);
    assert.equal(colorParameters({ matrix: 'smpte170m', fullRange: true }, bits, 480).range[2], 2 ** (bits - 1) / max);
  }
});
