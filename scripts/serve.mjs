import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(302, { Location: '/web-compare/' }); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      let relative = decodeURIComponent(url.pathname);
      if (relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(root, '.' + relative);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(4173, '127.0.0.1', () => console.log('http://localhost:4173/web-compare/'));
}
