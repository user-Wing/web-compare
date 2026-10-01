export const isWipe = mode => ['ab', 'abc-row', 'abc-column', 'abc-left', 'abc-right', 'abcd'].includes(mode);

export function layoutChoices(count) {
  if (count <= 1) return [['single', '单路']];
  if (count === 2) return [['side', '两路并排'], ['ab', 'AB 滑块']];
  if (count === 3) return [['side', '三路并排'], ['abc-row', 'ABC 横向三段'], ['abc-column', 'ABC 纵向三段'], ['abc-left', 'ABC 左一右二'], ['abc-right', 'ABC 右一左二']];
  if (count === 4) return [['grid', '四路 2×2'], ['abcd', 'ABCD 滑块']];
  return [['grid', '三列网格']];
}

export function regions(count, mode, width, height, split) {
  const [x, x2, y, y2] = [split.x * width, split.x2 * width, split.y * height, split.y2 * height];
  const rect = (x, y, w, h) => ({ x, y, w, h });
  const full = rect(0, 0, width, height);
  let clips;
  if (count <= 1) clips = [full];
  else if (mode === 'ab') clips = [rect(0, 0, x, height), rect(x, 0, width - x, height)];
  else if (mode === 'abc-row') clips = [rect(0, 0, x, height), rect(x, 0, x2 - x, height), rect(x2, 0, width - x2, height)];
  else if (mode === 'abc-column') clips = [rect(0, 0, width, y), rect(0, y, width, y2 - y), rect(0, y2, width, height - y2)];
  else if (mode === 'abc-left') clips = [rect(0, 0, x, height), rect(x, 0, width - x, y), rect(x, y, width - x, height - y)];
  else if (mode === 'abc-right') clips = [rect(x, 0, width - x, height), rect(0, 0, x, y), rect(0, y, x, height - y)];
  else if (mode === 'abcd') clips = [rect(0, 0, x, y), rect(x, 0, width - x, y), rect(0, y, x, height - y), rect(x, y, width - x, height - y)];
  else if (mode === 'side') clips = Array.from({ length: count }, (_, i) => rect(i * width / count, 0, width / count, height));
  else {
    const columns = count === 4 ? 2 : Math.min(3, count), rows = Math.ceil(count / columns);
    clips = Array.from({ length: count }, (_, i) => rect(i % columns * width / columns, Math.floor(i / columns) * height / rows, width / columns, height / rows));
  }
  return clips.map(clip => ({ clip, viewport: isWipe(mode) ? full : clip }));
}

export function handles(mode, split) {
  const vertical = (key, start = 0, end = 1) => ({ key, axis: 'x', value: split[key], start, end });
  const horizontal = (key, start = 0, end = 1) => ({ key, axis: 'y', value: split[key], start, end });
  if (mode === 'ab') return [vertical('x')];
  if (mode === 'abc-row') return [vertical('x'), vertical('x2')];
  if (mode === 'abc-column') return [horizontal('y'), horizontal('y2')];
  if (mode === 'abc-left' || mode === 'abc-right') return [vertical('x'), horizontal('y', mode === 'abc-left' ? split.x : 0, mode === 'abc-left' ? 1 : split.x), { key: 'xy', axis: 'xy' }];
  if (mode === 'abcd') return [vertical('x'), horizontal('y'), { key: 'xy', axis: 'xy' }];
  return [];
}

export function assignSource(slots, slot, source) {
  const result = [...slots], existing = result.indexOf(source), previous = result[slot];
  if (existing >= 0) result[existing] = previous;
  result[slot] = source;
  return result;
}
