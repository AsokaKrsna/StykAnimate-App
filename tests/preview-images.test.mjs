import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewImages} from '../src/preview-images.mjs';

const item = url => ({type: 'image', asset: {url}});
const bitmap = () => ({width: 4, height: 2, closed: 0, close() {this.closed++;}});
function setup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), workers = [];
  globalThis.Worker = class {
    constructor() {this.messages = []; workers.push(this);}
    postMessage(message) {this.messages.push(message);}
    terminate() {this.terminated = true;}
  };
  const images = new PreviewImages();
  t.after(() => {images.clear(); if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker;});
  return {images, workers};
}

test('a queued old-worker response cannot replace the next document or leak its bitmap', async t => {
  const {images, workers} = setup(t), first = images.prepare([item('a')]);
  const rejected = assert.rejects(first, {name: 'AbortError'}), old = workers[0];
  images.clear(); await rejected;
  const next = images.prepare([item('b')]), obsolete = bitmap();
  old.onmessage({data: {id: old.messages[0].id, images: [{url: 'a', bitmap: obsolete, width: 8192, height: 4096}]}});
  assert.equal(obsolete.closed, 1); assert.equal(images.size, 0);
  const valid = bitmap(), current = workers[1];
  current.onmessage({data: {id: current.messages[0].id, images: [{url: 'b', bitmap: valid, width: 8192, height: 4096}]}});
  await next; assert.equal(images.get('b'), valid); assert.equal(valid.naturalWidth, 8192); assert.equal(images.bytes, 32);
});

test('rapid viewport requests coalesce and replaced copies release their pixels', async t => {
  const {images, workers} = setup(t), first = images.prepare([item('a')]), middle = images.prepare([item('b')]), latest = images.prepare([item('c')]);
  await middle; const worker = workers[0]; assert.equal(worker.messages.length, 1);
  const a = bitmap(); worker.onmessage({data: {id: worker.messages[0].id, images: [{url: 'a', bitmap: a, width: 4, height: 2}]}});
  await first; assert.equal(worker.messages.length, 2); assert.equal(worker.messages[1].items[0].asset.url, 'c');
  const c = bitmap(); worker.onmessage({data: {id: worker.messages[1].id, images: [{url: 'c', bitmap: c, width: 4, height: 2}]}});
  await latest; assert.equal(a.closed, 1); assert.equal(images.size, 1); assert.equal(images.bytes, 32);
  images.clear(); assert.equal(c.closed, 1); assert.equal(images.bytes, 0);
});
