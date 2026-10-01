import { VideoLane } from './media.js';
import { AudioPlayer } from './audio.js';
import { GpuRenderer } from './renderer.js';
import { KERNELS } from './kernels.js';
import { layoutChoices, regions, handles, isWipe, assignSource } from './layout.js';
import { clamp, fittedScale, frameIndex, zoomAt, LatestQueue } from './math.js';

const letters = 'ABCDEFGHI';
const newView = () => ({ scale: 1, x: 0, y: 0, fit: true });
const options = (items, selected) => items.map(([value, label]) => `<option value="${value}"${String(value) === String(selected) ? ' selected' : ''}>${label}</option>`).join('');

export function mount(root) {
  root.innerHTML = `
    <header><div><h1>Web Compare <small>多路视频对比</small></h1><p>最多九路 · 实际 PTS · GPU 重建与缩放 ｜ 本地处理，不上传视频</p></div>
      <label class="file-label">添加视频 <input id="files" type="file" multiple accept=".mp4,.mkv,.mov"></label>
      <label>显示 <select id="count">${options([['2', '两路'], ['3', '三路'], ['4', '四路'], ['all', '全部 / 网格']], '2')}</select></label>
      <select id="layout" aria-label="对比布局"></select><label><input id="sync" type="checkbox" checked>同步缩放</label></header>
    <details id="sources-panel" open><summary>视频源与时间对齐 <span id="source-count">0 / 9</span></summary>
      <section class="sources" aria-label="视频源">${Array.from({ length: 9 }, (_, i) => `
        <div class="source" data-lane="${i}"${i > 1 ? ' hidden' : ''}>
          <label class="file-label">源 ${letters[i]} <input id="file${i}" type="file" accept=".mp4,.mkv,.mov"></label>
          <span id="name${i}">选择或拖入视频</span><button id="remove${i}" aria-label="卸载源 ${letters[i]}" disabled>×</button>
          <output id="info${i}">未加载</output><output id="color${i}" class="color-info"></output>
          <div class="align"><label>偏移（秒）<input id="offset${i}" type="number" value="0" step="0.001" disabled></label>
          ${[[-1, '−1 帧'], [1, '+1 帧'], [-2, '−1 秒'], [2, '+1 秒']].map(([action, label]) => `<button data-align="${action}" data-source="${i}" disabled>${label}</button>`).join('')}
          <input id="track${i}" aria-label="源 ${letters[i]} 时间轴" type="range" min="0" max="0" step="0.001" value="0" disabled></div>
        </div>`).join('')}</section></details>
    <section class="toolbar" aria-label="画布设置">
      <button id="fit">适应窗口</button><button id="actual">100%</button><button id="minus" aria-label="缩小">−</button><output id="zoom">Fit</output><button id="plus" aria-label="放大">＋</button>
      <label>放大 <select id="upscale">${options(KERNELS.slice(0, 9).map((s, i) => [i, s]), 0)}</select></label>
      <label>缩小 <select id="downscale">${options(KERNELS.slice(0, 6).map((s, i) => [i, s]), 3)}</select></label>
      <label>色度重建 <select id="chroma">${options(KERNELS.map((s, i) => [i, s]), 1)}</select></label>
      <label><input id="anti" type="checkbox" checked>抗振铃</label>
      <label>色度位置 <select id="siting"><option value="center">居中</option><option value="left">左对齐</option></select></label><button id="fullscreen">全屏</button>
    </section>
    <div id="stage" tabindex="0" aria-label="对比画布，滚轮放大、拖动画面平移"><canvas id="canvas"></canvas>
      ${Array.from({ length: 9 }, (_, i) => `<label id="badge${i}" class="badge" hidden>${letters[i]} <select id="slot${i}" aria-label="${letters[i]} 区域视频源"></select></label>`).join('')}
      ${['x', 'x2', 'y', 'y2', 'xy'].map(key => `<button id="handle-${key}" class="divider" data-handle="${key}" role="slider" aria-label="${key} 分割位置" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" hidden>↔</button>`).join('')}
      <div id="empty">选择或拖入 MP4 / MKV / MOV<br><small>滚轮 / 双指缩放 · 拖动平移 · 双击适应窗口</small></div><output id="pixel" hidden></output>
    </div>
    <section class="transport"><button id="prev" disabled>◀ 帧</button><button id="play" disabled>播放</button><button id="next" disabled>帧 ▶</button>
      <output id="time">0.000 / 0.000 s</output><input id="timeline" aria-label="共同时间位置" type="range" min="0" max="0" step="0.001" value="0" disabled>
      <label>基准 <select id="master" aria-label="逐帧基准视频"></select></label><label>音频 <select id="audio"><option value="mute">静音</option></select></label>
      <label>音量 <input id="volume" aria-label="音量" type="range" min="0" max="1" step="0.01" value="0.7"></label>
    </section><footer><output id="status" role="status">左右方向键逐帧，空格播放/暂停；色度核只对可读取 YUV 的帧生效。</output><span>SDR · 无导出 · HDR/广色域回退浏览器</span></footer>`;
  const $ = id => root.querySelector(`#${id}`), stage = $('stage'), canvas = $('canvas');
  const lanes = Array(9).fill(null), presented = Array(9).fill(null), loading = Array(9).fill(false), tokens = Array(9).fill(0);
  const offsets = Array(9).fill(0), views = Array.from({ length: 9 }, newView);
  let order = Array.from({ length: 9 }, (_, i) => i), mode = 'side', active = 0, master = 0;
  let syncPreference = true;
  let split = { x: .5, x2: 2 / 3, y: .5, y2: 2 / 3 };
  let time = 0, playing = false, anchorTime = 0, anchorClock = 0, now = () => performance.now() / 1000;
  let width = 1, height = 1, disposed = false, raf = 0, renderer = null, gpuReady = false, playVersion = 0;
  const status = message => { $('status').textContent = message; };
  const settings = () => ({ upscale: Number($('upscale').value), downscale: Number($('downscale').value), chroma: Number($('chroma').value), anti: $('anti').checked, siting: $('siting').value });
  const loaded = () => lanes.map((lane, i) => lane || loading[i] ? i : -1).filter(i => i >= 0);
  const count = () => $('count').value === 'all' ? Math.max(2, loaded().length) : Number($('count').value);
  const visible = () => order.slice(0, count());
  const reference = () => lanes[master] || visible().map(i => lanes[i]).find(Boolean) || lanes.find(Boolean);
  const duration = () => Math.max(0, (lanes[master]?.duration ?? reference()?.duration ?? 0) - (lanes[master] ? offsets[master] : 0));
  const sync = () => isWipe(mode) || syncPreference;
  const refSource = () => visible().find(i => lanes[i]) ?? active;
  const fail = error => { pause(); status(error.message || String(error)); };
  const audio = new AudioPlayer(fail);
  const queue = new LatestQueue(async (request, current) => {
    const preview = typeof request === 'object', target = preview ? request.time : request;
    if (!renderer || !gpuReady || (!preview && loading.some(Boolean))) return;
    const ids = visible().filter(i => lanes[i]);
    if (!preview) await Promise.all(ids.map(i => lanes[i].frameAt(target + offsets[i])));
    if (!current() || disposed) return;
    const candidates = Array(9).fill(null), fresh = [];
    ids.forEach(i => {
      if (presented[i]?.timestamp === lanes[i].current.timestamp) candidates[i] = presented[i];
      else { candidates[i] = lanes[i].current.clone(); fresh.push(candidates[i]); }
    });
    try {
      if (!await renderer.prepare(candidates, settings(), () => current() && !disposed)) { fresh.forEach(sample => sample.close()); return; }
      presented.forEach((sample, i) => { if (sample !== candidates[i]) sample?.close(); presented[i] = candidates[i]; });
      time = target; draw(); controls();
    } catch (error) { fresh.forEach(sample => sample.close()); throw error; }
  }, fail);

  function controls() {
    const busy = loading.some(Boolean), available = !!reference() && !busy && gpuReady;
    for (const id of ['play', 'prev', 'next', 'timeline']) $(id).disabled = !available;
    $('play').textContent = playing ? '暂停' : '播放';
    $('timeline').max = String(duration()); $('timeline').value = String(time); $('time').textContent = `${time.toFixed(3)} / ${duration().toFixed(3)} s`;
    for (let i = 0; i < 9; i++) {
      const lane = lanes[i], sample = presented[i];
      $('remove' + i).disabled = !lane && !loading[i]; $('offset' + i).disabled = !lane || busy; $('track' + i).disabled = !lane || busy;
      root.querySelectorAll(`[data-source="${i}"]`).forEach(button => { button.disabled = !lane || busy; });
      if (lane && !loading[i]) {
        $('info' + i).textContent = sample ? `${lane.width}×${lane.height} · ${lane.codec} · 帧 ${frameIndex(lane.timestamps, sample.timestamp - lane.origin) + 1}/${lane.timestamps.length} · ${(sample.timestamp - lane.origin).toFixed(6)} s` : `${lane.width}×${lane.height} · ${lane.codec} · ${lane.timestamps.length} 帧 · 未显示`;
        $('color' + i).textContent = renderer?.cache[i]?.description || '';
        $('track' + i).max = String(lane.duration); $('track' + i).value = String(clamp(time + offsets[i], 0, lane.duration));
      }
    }
  }
  function refreshSources(auto = false) {
    const ids = loaded(); order = [...order.filter(i => ids.includes(i)), ...order.filter(i => !ids.includes(i))];
    if (auto && ids.length > 2) $('count').value = 'all';
    if (!lanes[master]) master = ids[0] ?? 0;
    $('master').innerHTML = options(ids.map(i => [i, `源 ${letters[i]}`]), master);
    const audioValue = $('audio').value;
    $('audio').innerHTML = options([['mute', '静音'], ...ids.flatMap(i => (lanes[i]?.audioTracks || []).map((_, t) => [`${i}:${t}`, `源 ${letters[i]} · 音轨 ${t + 1}`]))], audioValue);
    if (!$('audio').value) $('audio').value = 'mute';
    for (let i = 0; i < 9; i++) {
      root.querySelector(`[data-lane="${i}"]`).hidden = i > 1 && !ids.includes(i);
      const select = $('slot' + i); select.replaceChildren();
      for (const id of ids) { const option = document.createElement('option'); option.value = String(id); option.textContent = `源 ${letters[id]} · ${lanes[id]?.name || '加载中'}`; select.append(option); }
      if (!ids.includes(order[i])) { const option = document.createElement('option'); option.value = String(order[i]); option.textContent = '未加载'; select.append(option); }
      select.value = String(order[i]);
    }
    $('source-count').textContent = `${ids.length} / 9`; refreshLayout(); controls();
  }
  function refreshLayout() {
    const choices = layoutChoices(count());
    if (!choices.some(([value]) => value === mode)) mode = choices[0][0];
    $('layout').innerHTML = options(choices, mode); $('sync').disabled = isWipe(mode); $('sync').checked = sync();
    if (!visible().includes(active)) active = visible()[0];
    draw();
  }
  function items() {
    const areas = regions(count(), mode, width, height, split), first = refSource();
    return visible().map((source, slot) => {
      const lane = lanes[source], ref = sync() ? lanes[first] : lane, view = views[sync() ? first : source];
      const { clip, viewport } = areas[slot];
      if (!lane || !ref) return { source, slot, clip, viewport, rect: { x: 0, y: 0, w: 0, h: 0 } };
      if (view.fit) { view.scale = fittedScale(viewport.w, viewport.h, ref.width, ref.height); view.x = view.y = 0; }
      const scale = Math.min(ref.width / lane.width, ref.height / lane.height) * view.scale, w = lane.width * scale, h = lane.height * scale;
      return { source, slot, clip, viewport, rect: { x: viewport.x + viewport.w / 2 + view.x - w / 2, y: viewport.y + viewport.h / 2 + view.y - h / 2, w, h } };
    });
  }
  function draw() {
    const list = items(); if (gpuReady) renderer.draw(list, settings(), width, height, window.devicePixelRatio || 1);
    list.forEach(({ slot, clip }) => {
      const badge = $('badge' + slot); badge.hidden = false;
      badge.style.left = `${isWipe(mode) ? slot * width / count() + 5 : clip.x + 5}px`; badge.style.top = `${isWipe(mode) ? 5 : clip.y + 5}px`;
      badge.style.maxWidth = `${Math.max(28, (isWipe(mode) ? width / count() : clip.w) - 10)}px`;
    });
    for (let i = count(); i < 9; i++) $('badge' + i).hidden = true;
    const activeHandles = handles(mode, split);
    for (const key of ['x', 'x2', 'y', 'y2', 'xy']) {
      const element = $('handle-' + key), handle = activeHandles.find(h => h.key === key); element.hidden = !handle;
      if (!handle) continue;
      element.dataset.axis = handle.axis;
      if (handle.axis === 'x') Object.assign(element.style, { left: `${handle.value * width}px`, top: `${handle.start * height}px`, width: '24px', height: `${(handle.end - handle.start) * height}px`, transform: 'translateX(-50%)' });
      else if (handle.axis === 'y') Object.assign(element.style, { left: `${handle.start * width}px`, top: `${handle.value * height}px`, width: `${(handle.end - handle.start) * width}px`, height: '24px', transform: 'translateY(-50%)' });
      else Object.assign(element.style, { left: `${split.x * width}px`, top: `${split.y * height}px`, width: '28px', height: '28px', transform: 'translate(-50%,-50%)' });
      element.setAttribute('aria-valuenow', String(Math.round((handle.axis === 'y' ? split[key] : split[key] ?? split.x) * 100)));
    }
    $('empty').hidden = !!reference(); const view = views[sync() ? refSource() : active];
    $('zoom').textContent = `${view.fit ? 'Fit · ' : ''}${Math.round(view.scale * 100)}%${sync() ? '' : ` · 源${letters[active]}`}`;
  }
  function resize() {
    width = Math.max(1, stage.clientWidth); height = Math.max(1, stage.clientHeight); const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw();
  }
  const observer = new ResizeObserver(resize); observer.observe(stage);
  function pause() { playing = false; ++playVersion; cancelAnimationFrame(raf); audio.stop(); controls(); }
  function seek(target) { pause(); queue.request(clamp(target, 0, duration())); }
  function tick() {
    if (!playing || disposed) return;
    const target = clamp(anchorTime + now() - anchorClock, 0, duration());
    if (!queue.running) queue.request(target);
    if (target >= duration()) { pause(); queue.request(duration()); } else raf = requestAnimationFrame(tick);
  }
  async function play() {
    if (!reference() || loading.some(Boolean) || !gpuReady) return;
    if (playing) return pause();
    const version = ++playVersion; if (time >= duration()) time = 0;
    anchorTime = time; now = () => performance.now() / 1000; anchorClock = now();
    try {
      if ($('audio').value !== 'mute') {
        const [source, track] = $('audio').value.split(':').map(Number);
        const clock = await audio.start(lanes[source], track, time, offsets[source], Number($('volume').value));
        if (!clock || version !== playVersion) return; now = clock.now; anchorClock = clock.clock;
      }
      if (version !== playVersion) return; playing = true; controls(); raf = requestAnimationFrame(tick);
    } catch (error) { fail(error); }
  }
  function step(direction) {
    const lane = reference(); if (!lane || loading.some(Boolean)) return;
    const source = lanes.indexOf(lane), index = frameIndex(lane.timestamps, time + offsets[source]);
    seek(lane.timestamps[clamp(index + direction, 0, lane.timestamps.length - 1)] - offsets[source]);
  }
  async function waitForDecode() { queue.invalidate(); while (queue.running) await new Promise(resolve => setTimeout(resolve, 10)); }
  async function load(i, file) {
    if (!file || !gpuReady) return;
    pause(); const token = ++tokens[i]; loading[i] = true; controls(); $('name' + i).textContent = file.name; status(`正在读取源 ${letters[i]}…`);
    await waitForDecode(); if (token !== tokens[i]) return;
    await lanes[i]?.close(); lanes[i] = null; presented[i]?.close(); presented[i] = null; offsets[i] = 0; $('offset' + i).value = '0'; views[i] = newView();
    try {
      const lane = await VideoLane.open(file, (preview, count) => {
        if (token !== tokens[i] || disposed) return; lanes[i] = preview;
        $('info' + i).textContent = count ? `正在建立帧索引：${count} 帧` : '正在显示首帧、建立帧索引…';
        if (!count) { refreshSources(true); queue.request({ time }); }
      }, () => token !== tokens[i] || disposed);
      if (token !== tokens[i] || disposed) { await lane.close(); return; }
      lanes[i] = lane; loading[i] = false; refreshSources(true);
      if (!loading.some(Boolean)) seek(Math.min(time, duration()));
      status('已就绪。各路按共同时间匹配实际 PTS；色度路径见各源说明。');
    } catch (error) {
      if (token !== tokens[i] || disposed) return;
      lanes[i] = null; loading[i] = false; $('info' + i).textContent = '加载失败'; $('color' + i).textContent = '';
      fail(error); refreshSources(); queue.request(Math.min(time, duration()));
    }
    controls();
  }
  async function remove(i) {
    pause(); ++tokens[i]; await waitForDecode(); if (!loading[i]) await lanes[i]?.close();
    lanes[i] = null; loading[i] = false; presented[i]?.close(); presented[i] = null; offsets[i] = 0;
    $('name' + i).textContent = '选择或拖入视频'; $('info' + i).textContent = '未加载'; $('color' + i).textContent = ''; $('offset' + i).value = '0';
    refreshSources(); seek(Math.min(time, duration()));
  }
  function loadFiles(files) {
    const free = lanes.map((lane, i) => !lane && !loading[i] ? i : -1).filter(i => i >= 0);
    [...files].slice(0, free.length).forEach((file, n) => void load(free[n], file)); if (files.length > free.length) status('最多加载 9 个视频；多余文件未导入。');
  }
  function align(i, action) {
    const lane = lanes[i]; if (!lane) return;
    if (Math.abs(action) === 2) offsets[i] += Math.sign(action);
    else { const index = frameIndex(lane.timestamps, time + offsets[i]); offsets[i] = lane.timestamps[clamp(index + action, 0, lane.timestamps.length - 1)] - time; }
    $('offset' + i).value = String(Number(offsets[i].toFixed(6))); seek(time);
  }
  $('files').onchange = event => { loadFiles(event.target.files); event.target.value = ''; };
  for (let i = 0; i < 9; i++) {
    $('file' + i).onchange = event => { void load(i, event.target.files[0]); event.target.value = ''; };
    $('remove' + i).onclick = () => void remove(i);
    $('slot' + i).onchange = event => { pause(); order = assignSource(order, i, Number(event.target.value)); refreshSources(); seek(time); };
    $('offset' + i).onchange = event => { const value = Number(event.target.value); offsets[i] = Number.isFinite(value) ? value : 0; seek(time); }; $('track' + i).oninput = event => seek(Number(event.target.value) - offsets[i]);
    const source = root.querySelector(`[data-lane="${i}"]`);
    source.ondragover = event => { event.preventDefault(); source.classList.add('dragover'); }; source.ondragleave = () => source.classList.remove('dragover');
    source.ondrop = event => { event.preventDefault(); source.classList.remove('dragover'); void load(i, event.dataTransfer.files[0]); };
  }
  root.querySelectorAll('[data-align]').forEach(button => { button.onclick = () => align(Number(button.dataset.source), Number(button.dataset.align)); });
  stage.ondragover = event => event.preventDefault(); stage.ondrop = event => { event.preventDefault(); loadFiles(event.dataTransfer.files); };
  $('count').onchange = () => { pause(); refreshLayout(); seek(time); };
  $('layout').onchange = event => {
    mode = event.target.value; split = { x: mode === 'abc-row' ? 1 / 3 : .5, x2: 2 / 3, y: mode === 'abc-column' ? 1 / 3 : .5, y2: 2 / 3 }; refreshLayout();
  };
  $('sync').onchange = () => { syncPreference = $('sync').checked; draw(); }; $('master').onchange = event => { master = Number(event.target.value); seek(time); };
  $('audio').onchange = () => seek(time); $('volume').oninput = () => { if (playing) { pause(); void play(); } };
  for (const id of ['upscale', 'downscale']) $(id).onchange = draw;
  for (const id of ['chroma', 'anti', 'siting']) $(id).onchange = () => seek(time);
  function applyView(value) { (sync() ? visible() : [active]).forEach(i => { views[i] = { ...value }; }); draw(); }
  $('fit').onclick = () => applyView(newView()); $('actual').onclick = () => applyView({ scale: 1, x: 0, y: 0, fit: false });
  function zoom(scale, item, p) {
    item ||= items().find(item => item.source === active) || items()[0]; const view = views[sync() ? refSource() : item.source], vp = item.viewport;
    p ||= { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 }; active = item.source;
    applyView({ ...zoomAt(view, clamp(scale, .02, 32), p.x - vp.x, p.y - vp.y, vp.w, vp.h), fit: false });
  }
  const currentView = () => views[sync() ? refSource() : active];
  $('minus').onclick = () => zoom(currentView().scale / 1.25); $('plus').onclick = () => zoom(currentView().scale * 1.25);
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1); $('play').onclick = () => void play(); $('timeline').oninput = event => seek(Number(event.target.value));
  $('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen(); }
    catch { status('当前嵌入页未授权全屏，请独立打开或使用浏览器全屏。'); }
  };
  function point(event) { const rect = stage.getBoundingClientRect(); return { x: event.clientX - rect.left - stage.clientLeft, y: event.clientY - rect.top - stage.clientTop }; }
  const hit = p => items().find(({ clip }) => p.x >= clip.x && p.x < clip.x + clip.w && p.y >= clip.y && p.y < clip.y + clip.h) || items()[0];
  stage.addEventListener('wheel', event => {
    event.preventDefault(); const p = point(event), item = hit(p); active = item.source;
    zoom(views[sync() ? refSource() : active].scale * Math.exp(-clamp(event.deltaY, -120, 120) * .002), item, p);
  }, { passive: false });
  stage.ondblclick = event => { active = hit(point(event)).source; applyView(newView()); };
  const pointers = new Map(); let draggingHandle = null;
  stage.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('.badge')) return;
    stage.focus(); stage.setPointerCapture(event.pointerId); const p = point(event); active = hit(p).source;
    draggingHandle = event.target.closest('[data-handle]')?.dataset.handle || null; pointers.set(event.pointerId, p);
  };
  function moveSplit(key, p) {
    if (key.includes('x')) split[key === 'x2' ? 'x2' : 'x'] = clamp(p.x / width, key === 'x2' ? split.x + .02 : 0, mode === 'abc-row' && key === 'x' ? split.x2 - .02 : 1);
    if (key.includes('y')) split[key === 'y2' ? 'y2' : 'y'] = clamp(p.y / height, key === 'y2' ? split.y + .02 : 0, mode === 'abc-column' && key === 'y' ? split.y2 - .02 : 1); draw();
  }
  stage.onpointermove = event => {
    const p = point(event); if (!pointers.has(event.pointerId)) { probe(p); return; } const old = pointers.get(event.pointerId);
    if (draggingHandle) { moveSplit(draggingHandle, p); pointers.set(event.pointerId, p); return; }
    if (pointers.size === 2) {
      const other = [...pointers].find(([id]) => id !== event.pointerId)[1], before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(p.x - other.x, p.y - other.y);
      if (before > 1) zoom(currentView().scale * after / before, items().find(item => item.source === active), { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 });
      applyView({ ...currentView(), x: currentView().x + (p.x - old.x) / 2, y: currentView().y + (p.y - old.y) / 2, fit: false });
    } else applyView({ ...currentView(), x: currentView().x + p.x - old.x, y: currentView().y + p.y - old.y, fit: false });
    pointers.set(event.pointerId, p);
  };
  const release = event => { pointers.delete(event.pointerId); if (!pointers.size) draggingHandle = null; };
  stage.onpointerup = release; stage.onpointercancel = release; stage.onlostpointercapture = release;
  for (const key of ['x', 'x2', 'y', 'y2', 'xy']) $('handle-' + key).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const change = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -.01 : .01, coordinate = key === 'xy' ? horizontal ? 'x' : 'y' : key;
    moveSplit(coordinate, { x: (split[coordinate] + change) * width, y: (split[coordinate] + change) * height });
  };
  let lastProbe = 0;
  function probe(p) {
    if (!gpuReady || performance.now() - lastProbe < 50) return;
    lastProbe = performance.now(); const item = hit(p), lane = lanes[item.source], r = item.rect;
    const inside = lane && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h; $('pixel').hidden = !inside; if (!inside) return;
    const dpr = window.devicePixelRatio || 1, rgb = renderer.readPixel(Math.floor(p.x * dpr), Math.floor(p.y * dpr));
    $('pixel').textContent = `${letters[item.slot]} / 源${letters[item.source]} (${Math.floor((p.x - r.x) / r.w * lane.width)}, ${Math.floor((p.y - r.y) / r.h * lane.height)}) 显示 RGB ${rgb.join(' ')} ｜ ${rgb.map(v => (v / 255).toFixed(4)).join(' ')}`;
  }
  stage.onpointerleave = () => { $('pixel').hidden = true; };
  root.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea')) return;
    if (event.code === 'Space') { event.preventDefault(); void play(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  });
  const hide = () => { if (document.hidden) pause(); }; document.addEventListener('visibilitychange', hide);
  function initializeGpu() {
    try {
      if (!globalThis.VideoDecoder || !globalThis.isSecureContext) throw new Error('需要支持 WebCodecs 的浏览器和 HTTPS（本机可用 localhost）。');
      renderer = new GpuRenderer(canvas); gpuReady = true; refreshSources();
    } catch (error) { gpuReady = false; fail(error); }
    $('files').disabled = !gpuReady; for (let i = 0; i < 9; i++) $('file' + i).disabled = !gpuReady;
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gpuReady = false; pause(); queue.invalidate(); status('GPU 上下文丢失，等待浏览器恢复…'); });
  canvas.addEventListener('webglcontextrestored', () => { initializeGpu(); queue.request(time); }); initializeGpu();
  return async () => {
    disposed = true; pause(); for (let i = 0; i < 9; i++) tokens[i]++;
    observer.disconnect(); document.removeEventListener('visibilitychange', hide); await audio.destroy(); await waitForDecode();
    await Promise.all(lanes.map((lane, i) => !loading[i] && lane?.close())); presented.forEach(sample => sample?.close()); renderer?.destroy();
  };
}
