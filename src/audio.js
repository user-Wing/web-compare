import { createWorkerClient } from './worker-client.js';
import { Input, BlobSource, ALL_FORMATS, AudioSampleSink } from 'mediabunny';

export class AudioPlayer {
  constructor(onError, base) { this.context = null; this.nodes = new Set(); this.version = 0; this.onError = onError; this.base = base; this.client = null; }
  async start(lane, trackIndex, time, offset, volume) {
    this.stop(); const version = this.version;
    this.context ||= new AudioContext(); await this.context.resume();
    this.gain ||= this.context.createGain(); this.gain.connect(this.context.destination); this.setVolume(volume);
    const client = await createWorkerClient('audio-worker.js', this.base);
    if (version !== this.version) { client.close(); return null; }
    this.client = client;
    // Decode an initial bounded batch before starting either clock.
    let first = await client.call('open', { file: lane.file, trackIndex, time: Math.max(0, time + offset + lane.origin) });
    let decoderClient = client;
    if (first.fallback && version === this.version) {
      // Opaque-origin sandbox workers may lack AudioDecoder although the parent document supports it.
      client.close(); this.client = null; decoderClient = null;
      this.input = new Input({ source: new BlobSource(lane.file), formats: ALL_FORMATS });
      const track = (await this.input.getAudioTracks())[trackIndex];
      if (!track || !await track.canDecode()) throw new Error('所选音轨无法在当前浏览器解码，请选择其他音轨或静音。');
      this.iterator = new AudioSampleSink(track).samples(Math.max(0, time + offset + lane.origin));
      first = await this.pullNative();
    }
    if (version !== this.version) return null;
    const clock = this.context.currentTime + .12, performanceClock = performance.now() / 1000 + .12;
    void this.pump(first, decoderClient, version, clock, lane.origin + offset + time);
    // A smooth wall clock avoids rendering bursts from a privacy-quantized AudioContext.currentTime.
    return { now: () => performance.now() / 1000, clock: performanceClock };
  }
  async pullNative() {
    const result = []; let duration = 0;
    while (duration < .2) {
      const { value: sample, done } = await this.iterator.next(); if (done) break;
      try {
        const planes = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
          const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex, format: 'f32-planar' }); return data;
        });
        result.push({ planes, timestamp: sample.timestamp, sampleRate: sample.sampleRate, length: sample.numberOfFrames }); duration += sample.duration;
      } finally { sample.close(); }
    }
    return result;
  }
  schedule(samples, clock, mediaStart) {
    let end = this.context.currentTime;
    for (const sample of samples) {
      const when = clock + sample.timestamp - mediaStart;
      const buffer = this.context.createBuffer(sample.planes.length, sample.length, sample.sampleRate);
      sample.planes.forEach((plane, i) => buffer.copyToChannel(plane, i));
      const skip = Math.max(0, this.context.currentTime - when);
      end = Math.max(end, when + buffer.duration);
      if (skip >= buffer.duration) continue;
      const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.gain); this.nodes.add(node);
      node.onended = () => { this.nodes.delete(node); node.disconnect(); };
      node.start(Math.max(when, this.context.currentTime), skip);
    }
    return end;
  }
  async pump(samples, client, version, clock, mediaStart) {
    try {
      while (samples.length && version === this.version) {
        const end = this.schedule(samples, clock, mediaStart);
        while (end > this.context.currentTime + .4 && version === this.version) await new Promise(resolve => setTimeout(resolve, 25));
        if (version !== this.version) return;
        samples = client ? await client.call('pull') : await this.pullNative();
      }
    } catch (error) { if (version === this.version) this.onError(error); }
  }
  setVolume(volume) { if (this.gain) this.gain.gain.setValueAtTime(volume, this.context.currentTime); }
  stop() {
    this.version++; this.client?.close(); this.client = null;
    this.input?.dispose(); this.input = null; this.iterator = null;
    for (const node of this.nodes) { try { node.stop(); } catch {} node.disconnect(); }
    this.nodes.clear(); this.gain?.disconnect();
  }
  async destroy() { this.stop(); await this.context?.close(); }
}
