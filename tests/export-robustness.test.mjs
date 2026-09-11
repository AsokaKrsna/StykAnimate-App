import test from 'node:test';
import assert from 'node:assert/strict';
import {exportMemoryPlan} from '../src/export-memory.mjs';
import {ExportFrameRenderer} from '../src/export-frame-renderer.mjs';
import {downsampleExportPixels} from '../src/export-sampling.mjs';
import {PlaybackResources} from '../src/playback-resources.mjs';
import {exportAnimation} from '../src/image-export.mjs';
import {encodeNativeVideo} from '../src/native-video-export.mjs';
import {encodeVfwVideo} from '../src/vfw-video-export.mjs';

const MiB = 1024 * 1024;
test('export plans bound working pixels on small devices without lowering output quality', () => {
  for (const deviceMemory of [.5, 1, 2, 4, 8, undefined]) {
    const plan = exportMemoryPlan(640, 360, 'sprites', {deviceMemory});
    assert.equal(plan.width, 640); assert.equal(plan.renderWidth, 1280);
    assert.ok(plan.frameWorkingBytes + plan.scratchBytes + plan.assetBytes <= plan.maxWorkingBytes);
    assert.ok(plan.tileSize * plan.factor + 8 <= 1032);
  }
  assert.throws(() => exportMemoryPlan(3840, 2160, 'sprites', {deviceMemory: 1}), {code: 'export_memory_limit'});
  assert.equal(exportMemoryPlan(3840, 2160, 'sprites', {deviceMemory: 4}).width, 3840);
  for (const budget of [0, Infinity, NaN, 1024, 513 * MiB])
    assert.throws(() => exportMemoryPlan(32, 32, 'edges', {maxWorkingBytes: budget}));
});

test('2× downsampling averages premultiplied color without transparent color fringes', () => {
  const pixels = new Uint8ClampedArray([255,0,0,0, 0,0,255,255, 0,0,255,255, 0,0,255,255]);
  assert.deepEqual([...downsampleExportPixels(pixels, 1, 1)], [0,0,255,191]);
  assert.deepEqual([...downsampleExportPixels(new Uint8ClampedArray(16), 1, 1)], [0,0,0,0]);
  assert.throws(() => downsampleExportPixels(new Uint8Array(15), 1, 1));
});

function environment(t, respond = message => ({id: message.id, ok: true})) {
  const workers = [], canvases = [], bitmaps = [];
  const bitmap = (width = 32, height = 32) => {
    const value = {width, height, closed: false, close() {this.closed = true;}};
    bitmaps.push(value); return value;
  };
  class Canvas extends EventTarget {
    constructor() {super(); canvases.push(this); this.width = this.height = 32;
      this.context = {canvas: this, isContextLost: () => this.lost, setTransform() {}, clearRect() {}, drawImage() {}};}
    getContext() {return this.context;}
  }
  class Worker extends EventTarget {
    constructor() {super(); workers.push(this);}
    postMessage(message) {
      const response = respond(message, bitmap);
      if (!response) return;
      queueMicrotask(() => {const event = new Event('message'); event.data = response; this.dispatchEvent(event);});
    }
    terminate() {this.terminated = true;}
  }
  for (const [key, value] of Object.entries({Worker, OffscreenCanvas: Canvas,
    document: {createElement: () => new Canvas()}, createImageBitmap: async canvas => bitmap(canvas.width, canvas.height)})) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
    t.after(() => {if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];});
  }
  return {workers, canvases, bitmaps};
}
const documentData = () => ({figure_types: [], keyframes: [{duration_raw: 1, objects: []}]});

test('unsafe dimensions and pre-aborted jobs allocate no worker or canvas', t => {
  const state = environment(t);
  assert.throws(() => new ExportFrameRenderer({width: 3840, height: 2160, maxWorkingBytes: 64 * MiB}), {code: 'export_memory_limit'});
  const controller = new AbortController(); controller.abort();
  assert.throws(() => new ExportFrameRenderer({width: 32, height: 32, signal: controller.signal}), {name: 'AbortError'});
  assert.equal(state.canvases.length, 0); assert.equal(state.workers.length, 0);
});

test('stalled rendering times out, releases pixels and permits a fresh export', async t => {
  const state = environment(t, (message, bitmap) => message.operation === 'render' && state.workers.length === 1
    ? null : {id: message.id, ok: true, ...(message.operation === 'render' ? {bitmap: bitmap()} : {})});
  const first = new ExportFrameRenderer({width: 32, height: 32, timeoutMs: 10});
  await first.load(documentData());
  await assert.rejects(first.renderTick(0), /timed out/);
  assert.equal(state.workers[0].terminated, true); assert.equal(first.canvas.width, 1);
  first.dispose();
  const next = new ExportFrameRenderer({width: 32, height: 32});
  try {await next.load(documentData()); assert.equal((await next.renderTick(0)).width, 32);}
  finally {next.dispose();}
});

test('cancellation during a stalled worker request rejects immediately and frees surfaces', async t => {
  const state = environment(t, message => message.operation === 'render' ? null : {id: message.id, ok: true});
  const controller = new AbortController(), renderer = new ExportFrameRenderer({width: 32, height: 32, signal: controller.signal});
  await renderer.load(documentData()); const pending = renderer.renderTick(0); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(renderer.canvas.width, 1); assert.ok(state.workers[0].terminated); renderer.dispose();
});

test('lost or undersized frames cannot be returned to an encoder, even if context restores', async t => {
  let undersized = false;
  const state = environment(t, (message, bitmap) => ({id: message.id, ok: true,
    ...(message.operation === 'render' ? {bitmap: bitmap(undersized ? 1 : 32)} : {})}));
  for (const failure of ['lost', 'restored', 'undersized']) {
    const renderer = new ExportFrameRenderer({width: 32, height: 32}); await renderer.load(documentData());
    if (failure === 'lost') renderer.canvas.lost = true;
    if (failure === 'restored') renderer.canvas.dispatchEvent(new Event('contextlost'));
    undersized = failure === 'undersized';
    await assert.rejects(renderer.renderTick(0), failure === 'undersized' ? /incomplete frame/ : {code: 'export_canvas_lost'});
    assert.equal(renderer.stats.renderedFrames, 0); assert.equal(renderer.canvas.width, 1); renderer.dispose();
  }
  assert.ok(state.bitmaps.every(bitmap => bitmap.closed));
  assert.ok(state.workers.every(worker => worker.terminated));
});

test('worker memory failures retain their actionable error and release the export', async t => {
  const state = environment(t, message => ({id: message.id, ok: false, code: 'export_memory_limit', error: 'Source image exceeds allowance.'}));
  const renderer = new ExportFrameRenderer({width: 32, height: 32});
  await assert.rejects(renderer.load(documentData()), {code: 'export_memory_limit'});
  assert.equal(renderer.canvas.width, 1); assert.ok(state.workers[0].terminated); renderer.dispose();
});

test('image and native video workers have bounded waits and cancel native jobs on timeout', async t => {
  const state = environment(t, () => null);
  const options = {width: 32, height: 32, fps: 24, totalFrames: 1, timeoutMs: 10, renderFrame: () => ({width: 32, height: 32})};
  await assert.rejects(exportAnimation({...options, format: 'png-sequence'}), /timed out/);
  let cancelled = 0;
  const desktop = Object.fromEntries(['beginVideoFrame','writeVideoChunk','endVideoFrame','finishVideoExport','readVideoChunk'].map(name => [name, async () => {}]));
  desktop.beginVideoExport = async () => ({token: 'test', maxChunkBytes: 1024});
  desktop.cancelVideoExport = async token => {assert.equal(token, 'test'); cancelled++;};
  await assert.rejects(encodeNativeVideo({...options, format: 'mp4', desktop}), /timed out/);
  assert.equal(cancelled, 1);
  const vfw = Object.fromEntries(['beginVfwFrame','writeVfwChunk','endVfwFrame','finishVfwExport','readVfwChunk'].map(name => [name, async () => {}]));
  vfw.beginVfwExport = async () => ({token: 'test', frameBytes: 32 * 32 * 3, maxChunkBytes: 1024});
  vfw.cancelVfwExport = desktop.cancelVideoExport;
  await assert.rejects(encodeVfwVideo({...options, codecId: 'vfw:x64:12345678', desktop: vfw}), /timed out/);
  assert.equal(cancelled, 2); assert.ok(state.workers.every(worker => worker.terminated));
});

test('export rejects oversized PNG metadata before pixel decoding and closes unexpected oversized decodes', async t => {
  const png = (width, height) => {
    const header = new Uint8Array(33); header.set([137,80,78,71,13,10,26,10]);
    const view = new DataView(header.buffer); view.setUint32(16, width); view.setUint32(20, height);
    return new Blob([header], {type: 'image/png'});
  };
  let decoded = 0, closed = 0, blob = png(8192, 8192);
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, blob: async () => blob}));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  globalThis.createImageBitmap = async () => {decoded++; return {width: 8192, height: 8192, close() {closed++;}};};
  t.after(() => {if (descriptor) Object.defineProperty(globalThis, 'createImageBitmap', descriptor); else delete globalThis.createImageBitmap;});
  const resources = new PlaybackResources({baseURL: 'https://example.test', maxBytes: 8 * MiB, hardMaxBytes: 8 * MiB});
  try {
    const items = [{type: 'image', asset: {url: '/large.png'}}];
    await assert.rejects(resources.preload(items), {code: 'export_memory_limit'}); assert.equal(decoded, 0);
    blob = png(1, 1);
    await assert.rejects(resources.preload(items), {code: 'export_memory_limit'}); assert.equal(decoded, 1); assert.equal(closed, 1);
    assert.equal(resources.bytes, 0); assert.equal(resources.images.size, 0);
  } finally {resources.dispose();}
});
