import { VideoSample } from 'mediabunny';
import { frameIndex } from './math.js';
import { createWorkerClient } from './worker-client.js';

const matrices = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' };
const primaries = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020' };
const transfers = { 1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1', 16: 'smpte2084', 18: 'arib-std-b67' };
function sampleFrom(raw, transform) {
  const match = /^yuv(420|422|444)p(?:(10|12)le)?$/.exec(raw.format);
  if (!match) throw new Error(`软件解码像素格式尚不支持：${raw.format}。`);
  const crop = raw.crop || { left: 0, right: 0, top: 0, bottom: 0 };
  const w = raw.width - crop.left - crop.right, h = raw.height - crop.top - crop.bottom;
  const frame = new VideoFrame(raw.data, {
    format: `I${match[1]}${match[2] ? 'P' + match[2] : ''}`, codedWidth: raw.width, codedHeight: raw.height, layout: raw.layout,
    visibleRect: { x: crop.left, y: crop.top, width: w, height: h },
    displayWidth: raw.sar?.[0] > 0 ? Math.round(w * raw.sar[0] / raw.sar[1]) : w, displayHeight: h,
    timestamp: Math.round(raw.timestamp * 1e6), duration: Math.round(raw.duration * 1e6),
    colorSpace: { matrix: matrices[raw.color[0]] || null, primaries: primaries[raw.color[1]] || null, transfer: transfers[raw.color[2]] || null, fullRange: raw.color[3] === 0 ? null : raw.color[3] === 2 },
  });
  return new VideoSample(frame, { ...transform, timestamp: raw.timestamp, duration: raw.duration });
}
export class SoftwareVideoLane {
  static async open(file, input, progress, cancelled, base) {
    const lane = new SoftwareVideoLane(); lane.input = input; lane.name = file.name; lane.file = file;
    try {
      lane.client = await createWorkerClient('software-worker.js', base, count => { if (cancelled()) lane.client.close(); else progress(lane, count); });
      const result = await lane.client.call('open', { file, base });
      if (cancelled()) throw new Error('导入已取消。');
      Object.assign(lane, result, { codec: result.codec + ' · WASM 软件解码' });
      const track = await input.getPrimaryVideoTrack();
      lane.transform = { rotation: await track.getRotation(), flip: await track.getFlip() };
      lane.current = sampleFrom(result.first, lane.transform); delete lane.first;
      lane.audioTracks = await input.getAudioTracks(); progress(lane, 0); return lane;
    } catch (error) { await lane.close(); throw error; }
  }
  get width() { return this.current?.displayWidth || 1; }
  get height() { return this.current?.displayHeight || 1; }
  async frameAt(time) {
    const target = this.timestamps[frameIndex(this.timestamps, time)] + this.origin;
    if (this.current && Math.abs(this.current.timestamp - target) < 1e-6) return this.current;
    const sample = sampleFrom(await this.client.call('frame', { time: target }), this.transform);
    this.current?.close(); this.current = sample; return sample;
  }
  async close() { this.client?.close(); this.current?.close(); this.current = null; this.input?.dispose(); }
}
