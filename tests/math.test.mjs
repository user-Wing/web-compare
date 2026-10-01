import test from 'node:test';
import assert from 'node:assert/strict';
import { frameIndex, zoomAt, fittedScale, LatestQueue } from '../src/math.js';

test('PTS binary lookup handles CFR, VFR, endpoints and exact boundaries', () => {
  const pts = [0, 0.04, 0.1, 0.15];
  assert.equal(frameIndex(pts, -1), 0);
  assert.equal(frameIndex(pts, 0.04), 1);
  assert.equal(frameIndex(pts, 0.099), 1);
  assert.equal(frameIndex(pts, 0.1), 2);
  assert.equal(frameIndex(pts, 20), 3);
});
test('zoom preserves the source point under the cursor', () => {
  const view = { scale: 2, x: 30, y: -10 };
  const next = zoomAt(view, 8, 600, 100, 800, 400);
  assert.equal((600 - 400 - next.x) / next.scale, (600 - 400 - view.x) / view.scale);
  assert.equal((100 - 200 - next.y) / next.scale, (100 - 200 - view.y) / view.scale);
  assert.equal(fittedScale(800, 600, 1920, 1080), 800 / 1920);
});
test('seek queue discards obsolete results and coalesces waiting seeks', async () => {
  const seen = [], committed = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const queue = new LatestQueue(async (value, current) => {
    seen.push(value); if (value === 1) await blocked;
    if (current()) committed.push(value);
  }, error => { throw error; });
  queue.request(1); queue.request(2); queue.request(3);
  release();
  while (queue.running) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(seen, [1, 3]); assert.deepEqual(committed, [3]);
});
test('invalidate prevents an in-flight result from being committed', async () => {
  let release, committed = false;
  const blocked = new Promise(resolve => { release = resolve; });
  const queue = new LatestQueue(async (_, current) => { await blocked; committed = current(); }, () => {});
  queue.request(0); queue.invalidate(); release();
  while (queue.running) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(committed, false);
});
