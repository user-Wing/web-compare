import { Input, BlobSource, ALL_FORMATS, VideoSampleSink, EncodedPacketSink } from 'mediabunny';
import { frameIndex } from './math.js';
import { SoftwareVideoLane } from './software-video.js';

export class VideoLane {
  static async open(file, progress, cancelled = () => false, base = new URL('.', location.href).href) {
    if (!/\.(mp4|mkv|mov)$/i.test(file.name)) throw new Error('当前版本只接受 MP4 / MKV / MOV 视频。');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let lane;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('文件中没有视频轨道。');
      const codec = await track.getCodec();
      if (!await track.canDecode()) {
        if (codec === 'hevc' || codec === null) return await SoftwareVideoLane.open(file, input, progress, cancelled, base);
        throw new Error(`当前浏览器或设备无法解码 ${codec || '此编码'}。MKV 是容器，不代表其内部所有编码都受支持。`);
      }
      lane = new VideoLane(input, track, file.name, codec);
      lane.file = file;
      const first = await track.getFirstTimestamp();
      lane.origin = first;
      try { lane.current = await lane.sink.getSample(first); }
      catch (error) {
        if (codec !== 'hevc') throw error;
        await lane.close();
        const fallbackInput = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        return await SoftwareVideoLane.open(file, fallbackInput, progress, cancelled, base);
      }
      if (!lane.current) throw new Error('未能解码首帧。');
      progress(lane, 0);
      const pts = [];
      let end = first;
      for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
        if (cancelled()) throw new Error('导入已取消。');
        pts.push(packet.timestamp);
        end = Math.max(end, packet.timestamp + packet.duration);
        if (pts.length % 2000 === 0) {
          progress(lane, pts.length);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      lane.timestamps = [...new Set(pts)].sort((a, b) => a - b).map(t => t - first);
      if (!lane.timestamps.length) throw new Error('没有可定位的视频帧。');
      lane.duration = Math.max(end - first, lane.timestamps.at(-1));
      lane.audioTracks = await input.getAudioTracks();
      return lane;
    } catch (error) {
      lane?.current?.close();
      input.dispose();
      throw error;
    }
  }
  constructor(input, track, name, codec) {
    this.input = input;
    this.track = track;
    this.name = name;
    this.codec = codec;
    this.sink = new VideoSampleSink(track);
    this.timestamps = [];
    this.current = null;
    this.next = null;
    this.iterator = null;
    this.origin = 0;
    this.duration = 0;
    this.audioTracks = [];
  }
  get width() { return this.current?.displayWidth || 1; }
  get height() { return this.current?.displayHeight || 1; }
  get index() { return frameIndex(this.timestamps, this.current.timestamp - this.origin); }
  async frameAt(time) {
    const index = frameIndex(this.timestamps, time);
    const target = this.timestamps[index] + this.origin;
    if (this.current && Math.abs(this.current.timestamp - target) < 1e-6) return this.current;
    if (!this.iterator || target < this.current.timestamp || target - this.current.timestamp > 0.5) {
      await this.resetIterator();
      this.iterator = this.sink.samples(target);
      this.next = (await this.iterator.next()).value ?? null;
    }
    while (this.next && this.next.timestamp <= target + 1e-6) {
      this.current?.close();
      this.current = this.next;
      this.next = (await this.iterator.next()).value ?? null;
    }
    return this.current;
  }
  async resetIterator() {
    this.next?.close();
    this.next = null;
    await this.iterator?.return();
    this.iterator = null;
  }
  async close() {
    await this.resetIterator();
    this.current?.close();
    this.current = null;
    this.input.dispose();
  }
}
