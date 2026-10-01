import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackPosition } from '../src/math.js';

test('audio pre-roll holds the selected PTS instead of triggering a backwards GOP seek', () => {
  const values = [-.12, -.10, -.05, 0, .02, .06].map(elapsed => playbackPosition(2, elapsed, 5));
  assert.deepEqual(values.slice(0, 4), [2, 2, 2, 2]);
  assert.ok(values.every((value, i) => !i || value >= values[i - 1]));
  assert.equal(playbackPosition(2, 100, 5), 5);
});
