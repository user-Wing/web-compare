import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../test-results/', import.meta.url));
await mkdir(directory, { recursive: true });
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
function encode(args) { const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
const sources = {};
for (const codec of ['hevc', 'vvc']) {
  sources[codec] = `${directory}/${codec}-software.mp4`;
  encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x192:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', codec === 'hevc' ? 'libx265' : 'libvvenc', '-preset', codec === 'hevc' ? 'ultrafast' : 'faster', '-pix_fmt', 'yuv420p10le', ...(codec === 'hevc' ? ['-x265-params', 'log-level=error:keyint=30:bframes=3'] : ['-qp', '32']), '-c:a', 'aac', sources[codec]]);
  for (const extension of ['mkv', 'mov']) encode(['-i', sources[codec], '-c', 'copy', `${directory}/${codec}-software.${extension}`]);
}
encode(['-display_rotation:v:0', '90', '-i', sources.hevc, '-c', 'copy', `${directory}/hevc-rotated.mov`]);
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`, reports = [];
try {
  for (const channel of (process.env.BROWSER_CHANNELS || 'chromium,msedge').split(',')) {
    const browser = await chromium.launch(channel === 'chromium' ? {} : { channel });
    try {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
      await page.addInitScript(() => {
        const original = VideoDecoder.isConfigSupported.bind(VideoDecoder);
        VideoDecoder.isConfigSupported = config => /^(hvc|hev)/.test(config.codec) ? Promise.resolve({ supported: false, config }) : original(config);
      });
      await page.goto(origin + '/web-compare/');
      async function ready(scope = page, source = 0) {
        for (let i = 0; i < 400; i++) {
          if (!await scope.locator('#play').isDisabled() && /帧 \d+\//.test(await scope.locator('#info' + source).textContent())) return;
          if ((await scope.locator('#info' + source).textContent()).includes('失败')) throw new Error(await scope.locator('#status').textContent());
          await page.waitForTimeout(50);
        }
        throw new Error(await scope.locator('#status').textContent());
      }
      for (const codec of ['hevc', 'vvc']) for (const extension of ['mp4', 'mkv', 'mov']) {
        console.log(`${channel}: ${codec}/${extension}`);
        await page.goto(origin + '/web-compare/');
        await page.locator('#file0').setInputFiles(`${directory}/${codec}-software.${extension}`); await ready();
        assert.match(await page.locator('#info0').textContent(), /WASM 软件解码/);
        assert.match(await page.locator('#color0').textContent(), /I420P10 原始色度/);
        const waitFrame = async number => {
          try { await page.waitForFunction(n => document.getElementById('info0').textContent.includes(`帧 ${n}/`), number, { timeout: 5000 }); }
          catch { assert.fail(`Expected ${number}: ${await page.locator('#info0').textContent()} / ${await page.locator('#time').textContent()} / ${await page.locator('#status').textContent()}`); }
        };
        await page.locator('#next').click(); await waitFrame(2);
        await page.locator('#timeline').evaluate(e => { e.value = '2'; e.dispatchEvent(new Event('input')); });
        await waitFrame(61);
        await page.locator('#prev').click(); await waitFrame(60);
      }
      await page.goto(origin + '/web-compare/');
      await page.locator('#file0').setInputFiles(`${directory}/hevc-rotated.mov`); await ready();
      assert.match(await page.locator('#info0').textContent(), /192×320/);
      assert.match(await page.locator('#color0').textContent(), /RGB 回退/);
      await page.goto(origin + '/web-compare/');
      await page.locator('#file0').setInputFiles(sources.vvc); await ready();
      await page.locator('#file1').setInputFiles(sources.hevc); await ready(page, 1);
      await page.locator('#layout').selectOption('ab');
      await page.locator('#audio').selectOption('mute');
      await page.locator('#timeline').evaluate(e => { e.value = '1'; e.dispatchEvent(new Event('input')); });
      await page.waitForFunction(() => document.getElementById('info0').textContent.includes('帧 31/'));
      await page.evaluate(() => { window.mutedFrames = []; window.mutedWatch = setInterval(() => window.mutedFrames.push(document.getElementById('info0').textContent), 10); });
      await page.locator('#play').click(); await page.waitForTimeout(1500); await page.locator('#play').click();
      const mutedFrames = await page.evaluate(() => { clearInterval(window.mutedWatch); return new Set(window.mutedFrames).size; });
      await page.locator('#audio').selectOption('0:0');
      await page.locator('#timeline').evaluate(e => { e.value = '1'; e.dispatchEvent(new Event('input')); });
      await page.waitForFunction(() => document.getElementById('info0').textContent.includes('帧 31/'));
      await page.evaluate(() => {
        window.observedFrames = [];
        window.watchFrames = setInterval(() => window.observedFrames.push(Number(/帧 (\d+)\//.exec(document.getElementById('info0').textContent)[1])), 10);
      });
      await page.locator('#play').click(); await page.waitForFunction(() => document.getElementById('play').textContent === '暂停');
      await page.waitForTimeout(1200);
      await page.locator('#volume').evaluate(e => { e.value = '.2'; e.dispatchEvent(new Event('input')); });
      assert.equal(await page.locator('#play').textContent(), '暂停', 'Volume must not restart playback');
      await page.waitForTimeout(300); await page.locator('#play').click();
      const frames = await page.evaluate(() => { clearInterval(window.watchFrames); return window.observedFrames; });
      assert.ok(frames.every((value, i) => !i || value >= frames[i - 1]), `Audio must not seek backwards: ${frames}`);
      assert.ok(new Set(frames).size >= 8 && new Set(frames).size >= mutedFrames * .55, `Audio frame throughput ${new Set(frames).size} vs muted ${mutedFrames}`);
      await page.screenshot({ path: `${directory}/${channel}-software.png` });
      await page.route('**/sandbox', route => route.fulfill({ contentType: 'text/html', body: `<iframe sandbox="allow-scripts allow-downloads allow-forms allow-modals" src="${origin}/web-compare/"></iframe>` }));
      await page.goto(origin + '/sandbox'); const embedded = page.frameLocator('iframe');
      await embedded.locator('#file0').setInputFiles(sources.vvc); await ready(embedded);
      await embedded.locator('#audio').selectOption('0:0'); await embedded.locator('#play').click(); await page.waitForTimeout(800);
      assert.equal(await embedded.locator('#play').textContent(), '暂停', await embedded.locator('#status').textContent());
      assert.deepEqual(errors, []);
      reports.push({ channel, status: 'passed', codecs: 'HEVC/VVC Main10 in MP4/MKV/MOV; HEVC native decoder disabled', audioFrames: new Set(frames).size, mutedFrames, checks: ['seek/forward/backward exact PTS', 'raw 10-bit YUV', 'MOV rotation', 'dual software A/B with selected audio', 'audio/muted throughput comparison', 'no backwards audio pre-roll', 'volume without restart', 'opaque-origin Worker/WASM/audio'] });
      console.log(channel, reports.at(-1));
    } finally { await browser.close(); }
  }
} finally { await writeFile(`${directory}/codec-results.json`, JSON.stringify(reports, null, 2)); await new Promise(resolve => server.close(resolve)); }
