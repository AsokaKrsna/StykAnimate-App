'use strict';
// Internal Electron entry point. The Node driver supplies an isolated profile.
// executeJavaScript uses Electron IPC; no DevTools session pauses new workers.
const {app, dialog} = require('electron');
const {writeFile} = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const input = process.env.STYK_BENCH_INPUT, output = process.env.STYK_BENCH_OUTPUT;
assert.ok(input && output && process.env.STYK_USER_DATA_DIR, 'Run through the benchmark driver');
const started = performance.now(); let running = false;
dialog.showOpenDialog = async () => ({canceled: false, filePaths: [input]});
app.on('browser-window-created', (_event, window) => {
  if (running) return; running = true;
  window.setIgnoreMouseEvents(true); window.setFocusable(false); window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => run(window).catch(async error => {
    console.error(error.stack || error); app.exit(1);
  }));
});
async function run(window) {
  const execute = code => window.webContents.executeJavaScript(code);
  const deadline = performance.now() + 60000;
  while (!await execute('Boolean(window.styk?.ready)')) {
    if (performance.now() > deadline) throw new Error('Editor readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await execute('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const readyAt = Date.now(), startupMs = performance.now() - started;
  const baseline = {versions: process.versions, processes: app.getAppMetrics()};
  const baselineHealth = await execute("fetch('/api/health').then(r => r.json())");
  // The driver disables collection before launch in this disposable profile.
  // Close the release splash before timing the import.
  await execute("for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); styk.editor.markSaved();");
  const imported = await execute(`(async () => {
    const tasks = [], errors = [], observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
    const onError = event => errors.push(event.message); window.addEventListener('error', onError);
    observer.observe({type: 'longtask'});
    const started = performance.now();
    try {
      await styk.actions.open();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {ms: performance.now() - started, timings: styk.state.lastImport, editorLoad: styk.editor.lastLoadTimings,
        frames: styk.editor.report.keyframes.length, figures: styk.editor.report.figure_types.length, renderer: styk.state.renderer.stats,
        longTasks: [...tasks, ...observer.takeRecords().map(entry => entry.duration)], errors};
    } finally {observer.disconnect(); window.removeEventListener('error', onError);}
  })()`);
  assert.ok(imported.frames > 1); assert.equal(imported.timings.cache_hit, false); assert.deepEqual(imported.errors, []);
  const processes = app.getAppMetrics();
  const digest = await execute(`(async () => {
    const r = styk.editor.report;
    const bytes = new TextEncoder().encode(JSON.stringify({figure_types: r.figure_types, keyframes: r.keyframes, backgrounds: r.backgrounds, fps: r.fps, width: r.canvas_width, height: r.canvas_height}));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
  })()`);
  const health = await execute("fetch('/api/health').then(r => r.json())");
  await writeFile(path.join(output, 'import.png'), (await window.webContents.capturePage()).toPNG());
  await writeFile(path.join(output, 'report.json'), JSON.stringify({readyAt, startupMs, baseline, baselineHealth, imported, processes, digest, health,
    environment: {cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), os: os.release()}}, null, 2));
  await execute('styk.editor.markSaved()');
  app.quit();
}
require('../desktop/main.cjs');
