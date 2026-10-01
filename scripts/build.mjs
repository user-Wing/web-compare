import { build } from 'esbuild';
import { mkdir, cp, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = new URL('../dist/web-compare/', import.meta.url);
await mkdir(out, { recursive: true });
await cp(new URL('../package/', import.meta.url), out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/runtime.js', import.meta.url))],
  outfile: fileURLToPath(new URL('runtime.js', out)),
  bundle: true, format: 'iife', globalName: 'WebCompare', target: 'es2022',
  minify: true, legalComments: 'eof',
});
for (const name of ['software-worker', 'audio-worker']) await build({
  entryPoints: [fileURLToPath(new URL(`../src/${name}.js`, import.meta.url))],
  outfile: fileURLToPath(new URL(`${name}.js`, out)), bundle: true, format: 'iife', target: 'es2022', minify: true, legalComments: 'eof',
});
await mkdir(new URL('vendor/', out), { recursive: true });
await copyFile(new URL('../node_modules/mediabunny/LICENSE', import.meta.url), new URL('vendor/mediabunny-LICENSE.txt', out));
await cp(new URL('../node_modules/mediabunny/src/', import.meta.url), new URL('vendor/mediabunny-source/', out), { recursive: true });
await copyFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), new URL('THIRD_PARTY_NOTICES.md', out));
await copyFile(new URL('../LICENSE', import.meta.url), new URL('LICENSE', out));
await copyFile(new URL('../README.md', import.meta.url), new URL('README.md', out));
console.log('Built dist/web-compare (self-contained, no CDN).');
