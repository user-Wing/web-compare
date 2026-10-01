export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Last presentation timestamp at or before the requested time (also handles VFR).
export function frameIndex(timestamps, time) {
  let lo = 0, hi = timestamps.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid] <= time + 1e-7) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

export function fittedScale(width, height, sourceWidth, sourceHeight) {
  return Math.min(width / sourceWidth, height / sourceHeight);
}

export function zoomAt(view, nextScale, x, y, width, height) {
  const ratio = nextScale / view.scale;
  return {
    scale: nextScale,
    x: x - width / 2 - (x - width / 2 - view.x) * ratio,
    y: y - height / 2 - (y - height / 2 - view.y) * ratio,
  };
}

// Only the most recent waiting request is needed while a decoder is busy.
export class LatestQueue {
  constructor(run, onError) {
    this.run = run;
    this.onError = onError;
    this.running = false;
    this.version = 0;
    this.pending = null;
  }
  request(value) {
    this.pending = { value, version: ++this.version };
    if (!this.running) void this.drain();
  }
  invalidate() {
    this.version++;
    this.pending = null;
  }
  async drain() {
    this.running = true;
    try {
      while (this.pending) {
        const { value, version } = this.pending;
        this.pending = null;
        try { await this.run(value, () => version === this.version); }
        catch (error) { if (version === this.version) this.onError(error); }
      }
    } finally { this.running = false; }
  }
}
