import { VideoSample } from 'mediabunny';
import { GpuRenderer, colorParameters } from '../src/renderer.js';

function check(condition, message) { if (!condition) throw new Error(message); }
function hash(bytes) { let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619); return hash >>> 0; }
function snapshot(renderer) { const gl = renderer.gl, data = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4); gl.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data); return data; }
const item = { source: 0, clip: { x: 0, y: 0, w: 64, h: 64 }, rect: { x: 0, y: 0, w: 64, h: 64 } };
export async function run() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const renderer = new GpuRenderer(canvas), settings = { upscale: 0, downscale: 0, chroma: 1, anti: false, siting: 'center' }, reports = [];
  async function render(sample) { await renderer.prepare([sample], settings); renderer.draw([item], settings, 64, 64, 1); return snapshot(renderer); }
  try {
    for (const matrix of ['bt709', 'smpte170m']) for (const fullRange of [false, true]) {
      const data = new Uint8Array(96); data.fill(128, 0, 64); data.fill(48, 64, 80); data.fill(196, 80);
      const frame = new VideoFrame(data, { format: 'I420', codedWidth: 8, codedHeight: 8, timestamp: 0, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix, fullRange } });
      const sample = new VideoSample(frame), { range, coefficients: [kr, kb] } = colorParameters({ matrix, fullRange }, 8, 8);
      const y = (128 / 255 - range[0]) * range[1], u = (48 / 255 - range[2]) * range[3], v = (196 / 255 - range[2]) * range[3], kg = 1 - kr - kb;
      const expected = [y + (2 - 2 * kr) * v, y - kb * (2 - 2 * kb) / kg * u - kr * (2 - 2 * kr) / kg * v, y + (2 - 2 * kb) * u].map(c => Math.round(Math.max(0, Math.min(1, c)) * 255));
      try {
        for (let chroma = 0; chroma < 11; chroma++) {
          settings.chroma = chroma; await render(sample); const pixel = renderer.readPixel(30, 30);
          check(pixel.every((value, i) => Math.abs(value - expected[i]) <= 2), `${matrix}/${fullRange}/kernel ${chroma}: ${pixel} != ${expected}`);
        }
        check(renderer.cache[0].raw, 'Synthetic I420 must use raw planes'); reports.push(`${matrix}/${fullRange}: all 11 chroma kernels preserve constant colors`);
      } finally { sample.close(); frame.close(); }
    }
    const data = new Uint8Array(96); data.fill(128, 0, 64);
    for (let i = 0; i < 16; i++) { data[64 + i] = i % 4 < 2 ? 32 : 224; data[80 + i] = i < 8 ? 196 : 48; }
    const frame = new VideoFrame(data, { format: 'I420', codedWidth: 8, codedHeight: 8, timestamp: 1, colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } });
    const sample = new VideoSample(frame);
    try {
      settings.chroma = 0; const nearest = hash(await render(sample)); settings.chroma = 1; const linear = hash(await render(sample));
      check(nearest !== linear, 'Independent chroma reconstruction must change color edges'); reports.push('Independent chroma kernels produce different color-edge pixels');
      settings.chroma = 1; await render(sample);
      const hashes = [];
      for (let upscale = 0; upscale < 9; upscale++) { settings.upscale = upscale; renderer.draw([item], settings, 64, 64, 1); hashes.push(hash(snapshot(renderer))); check(renderer.gl.getError() === renderer.gl.NO_ERROR, `Upscale ${upscale} GL error`); }
      check(new Set(hashes).size >= 6, `Scaling kernels must produce distinct results: ${hashes}`); reports.push({ scalingHashes: hashes });
      for (let downscale = 0; downscale < 6; downscale++) { settings.downscale = downscale; renderer.draw([{ ...item, rect: { x: 30, y: 30, w: 4, h: 4 } }], settings, 64, 64, 1); check(renderer.gl.getError() === renderer.gl.NO_ERROR, `Downscale ${downscale} GL error`); }
      reports.push('All six downscalers execute without GL errors');
    } finally { sample.close(); frame.close(); }
    const rgb = document.createElement('canvas'); rgb.width = rgb.height = 8; const ctx = rgb.getContext('2d'); ctx.fillStyle = '#c04020'; ctx.fillRect(0, 0, 8, 8);
    const rgbFrame = new VideoFrame(rgb, { timestamp: 2 }), rgbSample = new VideoSample(rgbFrame);
    try { settings.upscale = 0; await render(rgbSample); check(!renderer.cache[0].raw, 'RGBA must report RGB fallback'); check(renderer.readPixel(30, 30).every((v, i) => Math.abs(v - [192, 64, 32][i]) <= 1), 'RGB fallback preserves known color'); reports.push('RGB fallback is accurate and explicitly marked'); }
    finally { rgbSample.close(); rgbFrame.close(); }
    const high = new Uint16Array(96); high.fill(512, 0, 64); high.fill(512, 64);
    let highFrame;
    try { highFrame = new VideoFrame(high, { format: 'I420P10', codedWidth: 8, codedHeight: 8, timestamp: 3, colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } }); }
    catch (error) { reports.push(`I420P10 unavailable in this browser: ${error.message}`); }
    if (highFrame) {
      const highSample = new VideoSample(highFrame);
      try { await render(highSample); check(renderer.cache[0].raw, '10-bit must use integer planes'); check(renderer.readPixel(30, 30).every(v => Math.abs(v - 130) <= 2), '10-bit neutral chroma stays neutral'); reports.push('I420P10 integer plane reconstruction passes'); }
      finally { highSample.close(); highFrame.close(); }
    }
    for (const format of ['NV12', 'I422', 'I444', 'I420P12']) {
      const depth = format.endsWith('P12') ? 12 : 8;
      const count = format === 'I444' ? 192 : format === 'I422' ? 128 : 96;
      const data = depth === 12 ? new Uint16Array(count) : new Uint8Array(count);
      data.fill(2 ** (depth - 1));
      let frame;
      try { frame = new VideoFrame(data, { format, codedWidth: 8, codedHeight: 8, timestamp: 4, colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } }); }
      catch (error) { reports.push(`${format} unavailable: ${error.message}`); continue; }
      const sample = new VideoSample(frame);
      try {
        await render(sample); check(renderer.cache[0].raw, `${format} must use raw planes`);
        check(renderer.readPixel(30, 30).every(v => Math.abs(v - 130) <= 2), `${format} neutral chroma stays neutral`);
        reports.push(`${format} integer plane reconstruction passes`);
      } finally { sample.close(); frame.close(); }
    }
    return reports;
  } finally { renderer.destroy(); }
}
