export async function createWorkerClient(name, base, progress = () => {}) {
  const response = await fetch(new URL(name, base));
  if (!response.ok) throw new Error(`Worker 加载失败：${name} (${response.status})`);
  const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
  const worker = new Worker(url), pending = new Map();
  let sequence = 0;
  const rejectAll = error => { pending.forEach(({ reject }) => reject(error)); pending.clear(); };
  worker.onmessage = ({ data }) => {
    if (data.progress != null) return progress(data.progress);
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
  };
  worker.onerror = event => rejectAll(new Error(event.message || '解码 Worker 出错。'));
  return {
    call(action, data = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, action, ...data }); });
    },
    close() { worker.terminate(); URL.revokeObjectURL(url); rejectAll(new Error('解码已停止。')); },
  };
}
