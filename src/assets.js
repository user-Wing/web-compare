import { version } from '../package/manifest.json';
export function assetUrl(name, base) {
  const url = new URL(name, base); url.searchParams.set('v', version); return url.href;
}
export async function fetchAsset(name, base) {
  const url = assetUrl(name, base);
  let response;
  try { response = await fetch(url, { credentials: 'omit' }); }
  catch (error) { throw new Error(`解码资源请求失败：${url}；请检查网络、CORS/CSP 或部署缓存。${error.message}`); }
  if (!response.ok) throw new Error(`解码资源加载失败：${url} (${response.status})`);
  return response;
}
