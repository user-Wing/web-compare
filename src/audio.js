import { AudioSampleSink } from 'mediabunny';

export class AudioPlayer {
  constructor(onError) { this.context = null; this.nodes = new Set(); this.version = 0; this.onError = onError; }
  async start(lane, trackIndex, time, offset, volume) {
    this.stop();
    const version = this.version;
    this.context ||= new AudioContext();
    await this.context.resume();
    const tracks = await lane.input.getAudioTracks(), track = tracks[trackIndex];
    if (!track || !await track.canDecode()) throw new Error('所选音轨无法在当前浏览器解码，请选择其他音轨或静音。');
    if (version !== this.version) return null;
    const clock = this.context.currentTime + .05;
    const iterator = new AudioSampleSink(track).samples(time + offset + lane.origin);
    void this.pump(iterator, version, clock, lane.origin, offset, time, volume);
    return { now: () => this.context.currentTime, clock };
  }
  async pump(iterator, version, clock, origin, offset, time, volume) {
    try {
      for await (const sample of iterator) {
        try {
          if (version !== this.version) break;
          const when = clock + sample.timestamp - origin - offset - time;
          while (when > this.context.currentTime + .35 && version === this.version) await new Promise(resolve => setTimeout(resolve, 20));
          if (version !== this.version) break;
          const buffer = sample.toAudioBuffer(), skip = Math.max(0, this.context.currentTime - when);
          if (skip >= buffer.duration) continue;
          const node = this.context.createBufferSource(), gain = this.context.createGain();
          gain.gain.value = volume; node.buffer = buffer; node.connect(gain); gain.connect(this.context.destination);
          this.nodes.add(node);
          node.onended = () => { this.nodes.delete(node); node.disconnect(); gain.disconnect(); };
          node.start(Math.max(when, this.context.currentTime), skip);
        } finally { sample.close(); }
      }
    } catch (error) { if (version === this.version) this.onError(error); }
  }
  stop() {
    this.version++;
    for (const node of this.nodes) { try { node.stop(); } catch {} }
    this.nodes.clear();
  }
  async destroy() { this.stop(); await this.context?.close(); }
}
