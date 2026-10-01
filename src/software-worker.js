let av, formatContext, stream, decoder, packet, decoded = [], current = null, ended = false;
let timestamps = [], keys = [], origin = 0;
const integer = (lo, hi = 0) => (lo >>> 0) + hi * 4294967296;
const pts = frame => integer(frame.pts, frame.ptshi) * (frame.time_base_num || stream.time_base_num) / (frame.time_base_den || stream.time_base_den);
async function seek(time) {
  let key = keys[0];
  for (const candidate of keys) { if (candidate.pts > time + 1e-6) break; key = candidate; }
  // MOV seeks its sample table in decode time; a B-frame GOP's DTS precedes its presentation time.
  const start = key ? Math.max(0, Math.min(key.pts, key.dts)) : Math.max(0, time - 1);
  const stamp = Math.round(start * stream.time_base_den / stream.time_base_num);
  const code = await av.av_seek_frame(formatContext, stream.index, stamp | 0, Math.floor(stamp / 4294967296), 1);
  if (code < 0) throw new Error(`软件解码跳转失败 (${code})。`);
  await av.avcodec_flush_buffers(decoder[1]); decoded = []; current = null; ended = false;
}
async function next() {
  while (!decoded.length && !ended) {
    const result = await av.av_read_frame(formatContext, packet);
    if (result < 0) {
      if (result !== av.AVERROR_EOF) throw new Error(`视频包读取失败 (${result})。`);
      ended = true; decoded = await av.ff_decode_multi(decoder[1], decoder[2], decoder[3], [], true);
    } else {
      if (await av.AVPacket_stream_index(packet) === stream.index) decoded = await av.ff_decode_multi(decoder[1], decoder[2], decoder[3], [await av.ff_copyout_packet_ptr(packet)], { copyoutFrame: 'video' });
      await av.av_packet_unref(packet);
    }
  }
  return decoded.shift() || null;
}
async function frameAt(time) {
  if (!current || time < pts(current) - 1e-6 || time - pts(current) > .5) await seek(time);
  if (!current) current = await next();
  while (current) {
    if (!decoded.length && !ended) { const following = await next(); if (following) decoded.unshift(following); }
    if (!decoded.length || pts(decoded[0]) > time + 1e-6) break;
    current = decoded.shift();
  }
  if (!current) throw new Error('软件解码未输出视频帧。');
  // Sending a copy keeps the current frame available for requests within the same PTS interval.
  const data = current.data.slice();
  const descriptor = await av.av_pix_fmt_desc_get(current.format);
  const subsampling = `${await av.AVPixFmtDescriptor_log2_chroma_w(descriptor)}/${await av.AVPixFmtDescriptor_log2_chroma_h(descriptor)}`;
  const chroma = { '1/1': '420', '1/0': '422', '0/0': '444' }[subsampling];
  const depth = await av.AVPixFmtDescriptor_comp_depth(descriptor, 0);
  if (!chroma || ![8, 10, 12].includes(depth)) throw new Error('软件解码输出了不支持的像素格式。');
  const format = `yuv${chroma}p${depth > 8 ? depth + 'le' : ''}`;
  const color = await Promise.all(['color_space', 'color_primaries', 'color_trc', 'color_range'].map(key => av['AVCodecParameters_' + key](stream.codecpar)));
  return { data, layout: current.layout, width: current.width, height: current.height, crop: current.crop, sar: current.sample_aspect_ratio, format, color, timestamp: pts(current), duration: timestamps.length > 1 ? timestamps[1] - timestamps[0] : 1 / 30 };
}
async function open({ file, base }) {
  const codecs = new URL('vendor/codecs/', base).href;
  importScripts(codecs + 'libav-6.10.9.0-web-compare.js');
  av = await LibAV.LibAV({ base: codecs.replace(/\/$/, ''), wasmurl: codecs + 'libav-6.10.9.0-web-compare.wasm.wasm', noworker: true, noes6: true });
  av.onblockread = async (name, position, length) => {
    try { await av.ff_block_reader_dev_send(name, position, new Uint8Array(await file.slice(position, position + length).arrayBuffer())); }
    catch { await av.ff_block_reader_dev_send(name, position, null); }
  };
  await av.mkblockreaderdev('input', file.size);
  const demux = await av.ff_init_demuxer_file('input'); formatContext = demux[0];
  stream = demux[1].find(item => item.codec_type === av.AVMEDIA_TYPE_VIDEO);
  if (!stream) throw new Error('没有视频轨道。');
  const codec = await av.avcodec_get_name(stream.codec_id);
  if (!['hevc', 'vvc'].includes(codec)) throw new Error(`软件兜底仅支持 HEVC/VVC，此文件是 ${codec}。`);
  decoder = await av.ff_init_decoder(stream.codec_id, { codecpar: stream.codecpar, time_base: [stream.time_base_num, stream.time_base_den] });
  packet = await av.av_packet_alloc();
  const times = []; let end = 0;
  while (await av.av_read_frame(formatContext, packet) >= 0) {
    if (await av.AVPacket_stream_index(packet) === stream.index) {
      const t = integer(await av.AVPacket_pts(packet), await av.AVPacket_ptshi(packet)) * stream.time_base_num / stream.time_base_den;
      const d = integer(await av.AVPacket_duration(packet), await av.AVPacket_durationhi(packet)) * stream.time_base_num / stream.time_base_den;
      times.push(t); end = Math.max(end, t + d);
      if ((await av.AVPacket_flags(packet)) & 1) {
        const dts = integer(await av.AVPacket_dts(packet), await av.AVPacket_dtshi(packet)) * stream.time_base_num / stream.time_base_den;
        keys.push({ pts: t, dts: Math.abs(dts) < 1e9 ? dts : t });
      }
      if (times.length % 2000 === 0) postMessage({ progress: times.length });
    }
    await av.av_packet_unref(packet);
  }
  timestamps = [...new Set(times)].sort((a, b) => a - b);
  keys.sort((a, b) => a.pts - b.pts);
  if (!timestamps.length) throw new Error('视频中没有可定位的帧。');
  origin = timestamps[0];
  return { codec, origin, timestamps: timestamps.map(t => t - origin), duration: end - origin, first: await frameAt(origin) };
}
let chain = Promise.resolve();
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    try {
      const result = data.action === 'open' ? await open(data) : await frameAt(data.time);
      const buffer = (result.first || result).data.buffer;
      postMessage({ id: data.id, result }, [buffer]);
    } catch (error) { console.error(error); postMessage({ id: data.id, error: error.message }); }
  });
};
