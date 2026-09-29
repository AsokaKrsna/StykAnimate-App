// The deployable site, end to end in a real browser: build it, serve it under the
// production headers, and use it the way a person would with no server behind it.
//
//   node tests/web-build.browser.mjs            build into a temp directory first
//   STYK_WEB_DIR=build/web node tests/...       test an existing build
//   STYK_WEB_URL=https://... node tests/...     test a running site, such as `wrangler dev`
//                                               or a deployment (see docs/WEB.md)
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from './support/playwright.mjs';
import { buildWeb } from '../scripts/build-web.mjs';
import { startWebServer } from '../scripts/serve-web.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'styk-web-'));
const remote = process.env.STYK_WEB_URL;
const existing = process.env.STYK_WEB_DIR && path.resolve(process.env.STYK_WEB_DIR);
const site = remote
  ? { origin: remote.replace(/\/$/, ''), close: async () => {} }
  : await startWebServer({ root: existing ?? (await buildWeb({ output: path.join(temp, 'site') })).output });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log('PASS', name); };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // A download, not the native picker: the picker cannot be driven headlessly.
  await context.addInitScript(() => {
    delete window.showSaveFilePicker;
    document.addEventListener('securitypolicyviolation', (event) => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`));
  });
  const page = await context.newPage();
  const problems = [], requests = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const since = (mark) => requests.slice(mark);
  const runtimeLoaded = (list) => list.some((pathname) => pathname.startsWith('/vendor/pyodide/pyodide.asm'));

  await page.goto(site.origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.styk?.ready === true, undefined, { timeout: 60000 });
  check('The site boots with the browser codec selected', await page.evaluate(() => document.querySelector('meta[name="styk-codec"]')?.content === 'browser' && !window.stykDesktop));
  check('The editor renders (WebGPU or the compatibility renderer)', await page.evaluate(() => ['WebGPU', 'Canvas 2D fallback'].includes(window.styk.state.renderer.stats.backend)));
  check('Opening the editor does not download the Pivot runtime', !runtimeLoaded(requests));

  // Native projects never need the codec.
  const save = page.waitForEvent('download');
  await page.locator('[data-action="save"]').first().click();
  const saved = path.join(temp, 'project.styk');
  await (await save).saveAs(saved);
  check('A native project saves', (await stat(saved)).size > 100);
  await page.locator('#file-input').setInputFiles(saved);
  await page.waitForFunction(() => window.styk.editor.name === 'project', undefined, { timeout: 30000 });
  check('The saved project reopens', await page.evaluate(() => window.styk.editor.frame.objects.length >= 1));
  check('Native save and open do not download the Pivot runtime', !runtimeLoaded(requests));

  // Pivot files go through the in-browser codec.
  const exportPiv = async (name) => {
    const download = page.waitForEvent('download', { timeout: 120000 });
    await page.evaluate(() => window.styk.actions['export-piv']());
    const file = path.join(temp, name);
    await (await download).saveAs(file);
    return file;
  };
  let mark = requests.length;
  const first = await exportPiv('first.piv');
  check('A Pivot export downloads the runtime on demand', runtimeLoaded(since(mark)));
  check('The exported Pivot file has content', (await stat(first)).size > 100);

  await page.locator('#file-input').setInputFiles(first);
  await page.waitForFunction(() => window.styk.editor.name === 'first', undefined, { timeout: 120000 });
  check('The exported Pivot file reopens', await page.evaluate(() => window.styk.editor.frame.objects.length >= 1));

  mark = requests.length;
  const second = await exportPiv('second.piv');
  check('The runtime is downloaded once and reused', !runtimeLoaded(since(mark)));
  check('Re-exporting an unchanged Pivot import is byte-identical', Buffer.compare(await readFile(first), await readFile(second)) === 0);

  // Everything else the browser can do without the codec or a desktop encoder.
  const signatures = [
    ['export-png', 'frame.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'A PNG frame'],
    ['export-svg', 'frame.svg', Buffer.from('<svg'), 'An SVG frame'],
    ['export-gif', 'clip.gif', Buffer.from('GIF8'), 'An animated GIF'],
    ['export-video', 'clip.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'A WebM video (WebCodecs)'],
    ['export-png-sequence', 'frames.zip', Buffer.from('PK'), 'A PNG sequence archive'],
  ];
  for (const [action, name, signature, label] of signatures) {
    const download = page.waitForEvent('download', { timeout: 120000 });
    await page.evaluate((id) => window.styk.actions[id](), action);
    const file = path.join(temp, name);
    await (await download).saveAs(file);
    const bytes = await readFile(file);
    const recognised = name.endsWith('.svg') ? bytes.toString('utf8').includes('<svg') : bytes.subarray(0, signature.length).equals(signature);
    check(`${label} exports`, bytes.length > signature.length && recognised);
  }
  // MP4 is H.264 from WebCodecs; the file must decode in the browser at the scene's size and length.
  const mp4Download = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => window.styk.actions['export-mp4']());
  const mp4Path = path.join(temp, 'clip.mp4');
  await (await mp4Download).saveAs(mp4Path);
  const mp4 = await readFile(mp4Path);
  check('An MP4 video exports (H.264 by WebCodecs)', mp4.length > 100 && mp4.subarray(4, 8).toString() === 'ftyp');
  const decoded = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const video = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error(video.error?.message ?? 'The MP4 did not load.')); });
    const { editor } = window.styk, report = editor.report;
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration,
      expectedWidth: report.canvas_width, expectedHeight: report.canvas_height,
      expectedDuration: editor.totalTicks / (report.frame_delay_ms ? 1000 / report.frame_delay_ms : report.fps) };
  }, mp4.toString('base64'));
  check('The MP4 decodes at the scene size and length', decoded.width >= decoded.expectedWidth && decoded.width - decoded.expectedWidth <= 1
    && decoded.height >= decoded.expectedHeight && decoded.height - decoded.expectedHeight <= 1 && Math.abs(decoded.duration - decoded.expectedDuration) < 0.05);

  const capabilities = await page.evaluate(async () => (await import('/src/export-capabilities.mjs')).getExportCapabilities());
  const offered = capabilities.formats.find((item) => item.id === 'mp4');
  check('MP4 is offered with the browser encoder', offered?.supported === true && offered.provider === 'WebCodecs');
  for (const id of ['avi', 'wmv']) {
    const format = capabilities.formats.find((item) => item.id === id);
    check(`${id.toUpperCase()} is offered as desktop-only, with a reason`, format && format.supported === false && /desktop/i.test(format.reason ?? ''));
  }

  check('No request ever went to a server codec', !requests.some((pathname) => pathname.startsWith('/api/')));
  check('No console errors, page errors or CSP violations', problems.length === 0 || (console.error(problems), false));
  await context.close();
  console.log(`\n${checks.length} checks passed`);
} finally {
  await browser.close();
  await site.close();
  await rm(temp, { recursive: true, force: true });
}
