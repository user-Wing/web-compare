import { Input, BlobSource, ALL_FORMATS, AudioSampleSink } from 'mediabunny';
let input, iterator;
async function pull() {
  const samples = []; let duration = 0;
  while (duration < .2) {
    const { value: sample, done } = await iterator.next(); if (done) break;
    try {
      const planes = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex, format: 'f32-planar' }); return data;
      });
      samples.push({ planes, timestamp: sample.timestamp, sampleRate: sample.sampleRate, length: sample.numberOfFrames });
      duration += sample.duration;
    } finally { sample.close(); }
  }
  return samples;
}
let chain = Promise.resolve();
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    try {
      if (data.action === 'open') {
        if (!globalThis.AudioDecoder) { postMessage({ id: data.id, result: { fallback: true } }); return; }
        input = new Input({ source: new BlobSource(data.file), formats: ALL_FORMATS });
        const track = (await input.getAudioTracks())[data.trackIndex];
        if (!track || !await track.canDecode()) { postMessage({ id: data.id, result: { fallback: true } }); return; }
        iterator = new AudioSampleSink(track).samples(data.time);
      }
      const result = await pull();
      postMessage({ id: data.id, result }, result.flatMap(sample => sample.planes.map(plane => plane.buffer)));
    } catch (error) { postMessage({ id: data.id, error: error.message }); }
  });
};
