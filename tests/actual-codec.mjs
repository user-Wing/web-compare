import { chromium } from 'playwright';
import { createServer } from '../scripts/serve.mjs';
import assert from 'node:assert/strict';
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  page.on('console', message => console.log(message.type(), message.text()));
  page.on('requestfailed', request => console.log('REQUEST FAILED', request.url(), request.failure()));
  if (process.env.CODEC_BYPASS) await page.route('**/tool-packages/web-compare/**', route => { const url = new URL(route.request().url()); url.searchParams.set('v', process.env.CODEC_BYPASS); return route.continue({ url: url.href }); });
  await page.goto(process.env.CODEC_PAGE || `http://localhost:${server.address().port}/web-compare/`);
  await page.locator('#file0').setInputFiles(process.env.CODEC_SAMPLE);
  await page.waitForFunction(() => /帧 \d+\//.test(document.getElementById('info0').textContent) || document.getElementById('info0').textContent.includes('失败'), null, { timeout: 180000 });
  console.log(await page.locator('#info0').textContent(), await page.locator('#color0').textContent(), await page.locator('#status').textContent());
  assert.match(await page.locator('#info0').textContent(), /帧 \d+\//, await page.locator('#status').textContent());
  await page.locator('#next').click();
  await page.waitForFunction(() => document.getElementById('info0').textContent.includes('帧 2/'));
  if (Number(await page.locator('#timeline').getAttribute('max')) > 61) {
    await page.locator('#timeline').evaluate(e => { e.value = '60'; e.dispatchEvent(new Event('input')); });
    await page.waitForFunction(() => /· (\d+\.\d+) s/.test(document.getElementById('info0').textContent) && Number(/· (\d+\.\d+) s/.exec(document.getElementById('info0').textContent)[1]) >= 59.9, null, { timeout: 60000 });
    console.log('60s seek:', await page.locator('#info0').textContent());
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
