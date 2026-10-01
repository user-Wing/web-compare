import { chromium, firefox, webkit } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import { build } from 'esbuild';

const resultDir = fileURLToPath(new URL('../test-results/', import.meta.url));
await mkdir(resultDir, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('./gpu.entry.js', import.meta.url))], outfile: `${resultDir}/gpu-test.js`, bundle: true, format: 'iife', globalName: 'GpuTests' });
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const a = `${resultDir}/a.mkv`, b = `${resultDir}/b.mkv`, vfr = `${resultDir}/vfr.mkv`;
const large = `${resultDir}/2160p.mkv`;
const mp4 = `${resultDir}/sample.mp4`, mov = `${resultDir}/sample.mov`, av = `${resultDir}/audio.mp4`;
for (const [file, filter] of [[a, 'null'], [b, 'negate'], [vfr, "select=not(mod(n\\,3))"]]) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-vf', filter, '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-bf', '3', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const largeResult = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', large], { encoding: 'utf8' });
assert.equal(largeResult.status, 0, largeResult.stderr);
for (const file of [mp4, mov]) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-c', 'copy', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const avResult = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', av], { encoding: 'utf8' });
assert.equal(avResult.status, 0, avResult.stderr);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;
const reports = [];
try {
  for (const channel of (process.env.BROWSER_CHANNELS || 'chromium,msedge').split(',')) {
    const engine = { chromium, firefox, webkit }[channel] || chromium;
    const browser = await engine.launch({ ...(channel === 'msedge' || channel === 'chrome' ? { channel } : {}), headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const requests = [];
      page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
      await page.goto(origin + '/web-compare/');
      async function ready(scope, source = 0) {
        await scope.locator('#play').waitFor();
        await scope.waitForFunction?.(() => !document.getElementById('play').disabled);
        if (!scope.waitForFunction) {
          for (let i = 0; i < 300 && await scope.locator('#play').isDisabled(); i++) await page.waitForTimeout(100);
        }
        assert.equal(await scope.locator('#play').isDisabled(), false, await scope.locator('#status').textContent());
        for (let i = 0; i < 200 && !/帧 \d+\//.test(await scope.locator('#info' + source).textContent()); i++) await page.waitForTimeout(50);
        assert.match(await scope.locator('#info' + source).textContent(), /帧 \d+\//, await scope.locator('#status').textContent());
      }
      async function loadPair(scope) {
        await scope.locator('#file0').setInputFiles(a); await ready(scope);
        await scope.locator('#file1').setInputFiles(b); await ready(scope, 1);
      }
      const frames = async scope => Promise.all([0, 1].map(i => scope.locator('#info' + i).textContent()));
      const frameNumbers = values => values.map(v => Number(/帧 (\d+)\//.exec(v)?.[1]));
      const seek = async (scope, value) => {
        await scope.locator('#timeline').evaluate((element, target) => { element.value = String(target); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        await page.waitForTimeout(150);
      };
      await loadPair(page);
      assert.deepEqual(frameNumbers(await frames(page)), [1, 1]);
      await page.locator('#next').click(); await page.waitForTimeout(150);
      assert.deepEqual(frameNumbers(await frames(page)), [2, 2]);
      await page.locator('#prev').click(); await page.waitForTimeout(150);
      assert.deepEqual(frameNumbers(await frames(page)), [1, 1]);
      await seek(page, 2);
      assert.deepEqual(frameNumbers(await frames(page)), [61, 61]);
      await page.locator('#timeline').evaluate(element => {
        for (const value of [0.1, 2.8, 0.6, 1.7, 0.3, 2]) { element.value = value; element.dispatchEvent(new Event('input')); }
      });
      await page.waitForTimeout(500);
      assert.deepEqual(frameNumbers(await frames(page)), [61, 61]);
      await page.locator('#layout').selectOption('ab');
      const box = await page.locator('#stage').boundingBox();
      const divider = await page.locator('#handle-x').boundingBox();
      await page.mouse.move(divider.x + 12, divider.y + divider.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2); await page.mouse.up();
      assert.ok(Number(await page.locator('#handle-x').getAttribute('aria-valuenow')) > 65);
      const samplePoints = async () => page.locator('#canvas').evaluate(canvas => {
        const gl = canvas.getContext('webgl2');
        return [.25, .85].map(x => { const p = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; });
      });
      const pixels = await samplePoints(); assert.notDeepEqual(pixels[0], pixels[1]);
      // Moving the divider must clip the same full-size images, never rescale them.
      await page.locator('#handle-x').evaluate(element => { element.focus(); for (let i = 0; i < 100; i++) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      const fullA = await samplePoints();
      await page.locator('#handle-x').evaluate(element => { for (let i = 0; i < 100; i++) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
      const fullB = await samplePoints();
      assert.deepEqual(pixels[0], fullA[0]); assert.deepEqual(pixels[1], fullB[1]);
      await page.locator('#handle-x').evaluate(element => { for (let i = 0; i < 70; i++) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      assert.match(await page.locator('#color0').textContent(), /原始色度/);
      await page.locator('#actual').click();
      const drag = async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10); await page.mouse.up();
      };
      const probes = async (dx = 0, dy = 0) => page.locator('#canvas').evaluate((canvas, delta) => {
        const gl = canvas.getContext('webgl2'), colors = [];
        for (let y = -50; y <= 50; y += 25) for (let x = -120; x <= 120; x += 30) {
          const p = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width / 2 + x + delta.dx), canvas.height - 1 - Math.floor(canvas.height / 2 + y + delta.dy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); colors.push(...p);
        }
        return colors;
      }, { dx, dy });
      const beforePan = await probes(); await drag();
      assert.deepEqual(await probes(20, 10), beforePan, 'Pan moves 20/10 screen pixels at 100%');
      await page.mouse.wheel(0, -120); await page.waitForTimeout(50);
      const beforeZoomedPan = await probes(); await drag();
      assert.deepEqual(await probes(20, 10), beforeZoomedPan, 'Pan sensitivity stays unchanged after zoom');
      assert.ok(!String(await page.locator('#zoom').textContent()).includes('Fit'));
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.locator('#fit').click();
      const size = await page.locator('#canvas').evaluate(c => [c.width, c.height]);
      assert.ok(size[0] > 1400);
      await page.locator('#fullscreen').click(); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
      await page.locator('#fullscreen').click();
      await seek(page, 0);
      await page.locator('#play').click(); await page.waitForTimeout(600); await page.locator('#play').click();
      const pair = frameNumbers(await frames(page)); assert.ok(pair[0] > 5); assert.equal(pair[0], pair[1]);
      await page.locator('#offset1').fill('0.1'); await page.locator('#offset1').dispatchEvent('change'); await page.waitForTimeout(200);
      const shifted = frameNumbers(await frames(page)); assert.equal(shifted[1] - shifted[0], 3);
      await page.locator('#offset1').fill('0'); await page.locator('#offset1').dispatchEvent('change');
      await page.locator('#file1').setInputFiles(vfr); await ready(page, 1); await seek(page, .25);
      assert.deepEqual(frameNumbers(await frames(page)), [8, 3]);
      await page.locator('#next').click(); await page.waitForTimeout(150);
      assert.deepEqual(frameNumbers(await frames(page)), [9, 3]);
      await page.locator('#remove1').click(); await page.locator('#file1').setInputFiles(b); await ready(page, 1);
      // Mobile layout and DPR are tested separately from desktop resizing.
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${resultDir}/${channel}-mobile.png` });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2), 'Desktop controls fit in the viewport');
      await page.screenshot({ path: `${resultDir}/${channel}-ab.png` });
      await page.locator('#file0').setInputFiles(large); await ready(page);
      await page.locator('#file1').setInputFiles(large); await ready(page, 1);
      await seek(page, .5); await page.waitForTimeout(300);
      assert.deepEqual(frameNumbers(await frames(page)), [16, 16]);
      assert.ok((await frames(page)).every(text => text.includes('3840×2160')));
      await page.addScriptTag({ path: `${resultDir}/gpu-test.js` });
      const gpuResults = await page.evaluate(() => GpuTests.run());
      await page.locator('#file0').setInputFiles(a); await ready(page);
      await page.locator('#file1').setInputFiles(b); await ready(page, 1);
      await page.locator('#files').setInputFiles(mov); await ready(page, 2);
      for (const layout of ['side', 'abc-row', 'abc-column', 'abc-left', 'abc-right']) {
        await page.locator('#layout').selectOption(layout);
        assert.equal(await page.locator('.badge:visible').count(), 3);
        assert.equal(await page.locator('#canvas').evaluate(c => c.getContext('webgl2').getError()), 0);
        if (layout !== 'side') assert.equal(await page.locator('#sync').isDisabled(), true);
      }
      await page.locator('#files').setInputFiles(mp4); await ready(page, 3);
      await page.locator('#layout').selectOption('abcd');
      assert.equal(await page.locator('.badge:visible').count(), 4);
      await page.locator('#handle-xy').evaluate(element => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
      await page.locator('#slot0').selectOption('2'); await page.waitForTimeout(200);
      assert.equal(await page.locator('#slot2').inputValue(), '0');
      await page.locator('#offset2').fill('0.1'); await page.locator('#offset2').dispatchEvent('change'); await seek(page, 1);
      assert.equal(Number(/帧 (\d+)\//.exec(await page.locator('#info2').textContent())[1]), 34);
      await page.locator('[data-source="2"][data-align="1"]').click(); await page.waitForTimeout(150);
      assert.equal(Number(/帧 (\d+)\//.exec(await page.locator('#info2').textContent())[1]), 35);
      await page.locator('#count').selectOption('2'); await page.locator('#layout').selectOption('side');
      await page.locator('#sync').uncheck();
      // Finish the layout-triggered seek and ResizeObserver redraw before taking a pixel baseline.
      await seek(page, 1);
      await page.waitForFunction(() => /帧 31\//.test(document.getElementById('info1').textContent));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const halfHash = async () => page.locator('#canvas').evaluate(canvas => {
        const gl = canvas.getContext('webgl2'), x = Math.floor(canvas.width / 2), data = new Uint8Array((canvas.width - x) * canvas.height * 4);
        gl.readPixels(x, 0, canvas.width - x, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data); let h = 0; for (const v of data) h = Math.imul(h, 31) + v | 0; return h;
      });
      const unchanged = await halfHash(), bounds = await page.locator('#stage').boundingBox();
      await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height * .6); await page.mouse.wheel(0, -120); await page.waitForTimeout(80);
      assert.equal(await halfHash(), unchanged, 'Independent zoom leaves other pane unchanged');
      assert.deepEqual(await page.locator('#stage').boundingBox(), bounds, 'Zoom text must not reflow the toolbar and resize every pane');
      await page.locator('#sync').check(); await page.locator('#layout').selectOption('ab');
      await page.locator('#files').setInputFiles([a, b, mp4, mov, av]); await ready(page, 8);
      assert.equal(await page.locator('#source-count').textContent(), '9 / 9');
      assert.equal(await page.locator('.badge:visible').count(), 9);
      await seek(page, 1.5); await page.waitForTimeout(300);
      const allFrames = await Promise.all(Array.from({ length: 9 }, (_, i) => page.locator('#info' + i).textContent()));
      assert.ok(allFrames.every(text => /帧 \d+\//.test(text)));
      await page.locator('#fit').click(); await page.screenshot({ path: `${resultDir}/${channel}-nine.png` });
      await page.locator('#audio').selectOption('8:0'); await page.locator('#play').click(); await page.waitForTimeout(500);
      assert.equal(await page.locator('#play').textContent(), '暂停', await page.locator('#status').textContent());
      await page.locator('#play').click();
      await page.locator('#audio').selectOption('mute');
      await page.locator('#master').selectOption('2'); await page.locator('#next').click(); await page.waitForTimeout(200);
      // Remove one source while preserving the other eight decoder sessions.
      await page.locator('#remove4').click(); await page.waitForTimeout(150);
      assert.equal(await page.locator('#source-count').textContent(), '8 / 9');
      // Emulate the existing blog sandbox without weakening it with allow-same-origin.
      await page.route('**/sandbox', route => route.fulfill({ contentType: 'text/html', body: `<iframe style="width:100%;height:850px" sandbox="allow-scripts allow-downloads allow-forms allow-modals" src="${origin}/web-compare/"></iframe>` }));
      await page.goto(origin + '/sandbox');
      const embedded = page.frameLocator('iframe');
      await loadPair(embedded); await seek(embedded, 2);
      assert.deepEqual(frameNumbers(await frames(embedded)), [61, 61]);
      assert.deepEqual(errors, []);
      assert.equal(requests.some(r => r.method !== 'GET' || !r.url.startsWith(origin)), false, 'No uploads or CDN calls');
      reports.push({ channel, status: 'passed', checks: ['MP4/MKV/MOV', 'H264 B-frames', 'PTS seek/step', 'seek coalescing', 'paired playback', 'offset and per-source frame alignment', 'different frame rates', 'AB clipping pixel equality', 'pan pixel equality before/after zoom', 'resize/fullscreen', 'mobile layout', 'dual 2160p seek', 'all ABC layouts/ABCD', 'source assignment swap', 'independent zoom', 'nine-source grid', 'AAC selected-source audio', 'master selection', 'remove preserves other sessions', 'opaque-origin iframe', 'no uploads'], gpuResults, initialPixels: pixels });
      console.log(`${channel}: passed`);
    } finally { await browser.close(); }
  }
} finally {
  await writeFile(`${resultDir}/browser-results.json`, JSON.stringify(reports, null, 2));
  await new Promise(resolve => server.close(resolve));
}
