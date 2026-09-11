import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWebM, videoFrameWindow} from '../src/video-export.mjs';

test('browser video retains at most one 4K frame even after the encoder dequeues without output', async t => {
  const descriptors = ['VideoEncoder', 'VideoFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const frames = []; let instance;
  class Encoder extends EventTarget {
    static async isConfigSupported(config) {return {supported: true, config};}
    constructor(callbacks) {super(); instance = this; this.callbacks = callbacks; this.pending = []; this.peak = 0; this.state = 'unconfigured';}
    configure(config) {this.config = config; this.state = 'configured';}
    encode(frame, options) {
      this.pending.push({timestamp: frame.timestamp, type: options.keyFrame ? 'key' : 'delta'});
      this.peak = Math.max(this.peak, this.pending.length);
      this.encodeQueueSize = 0; this.dispatchEvent(new Event('dequeue'));
    }
    async flush() {for (const chunk of this.pending.splice(0)) this.callbacks.output({...chunk, byteLength: 4, copyTo(buffer) {buffer.set([1, 2, 3, 4]);}});}
    close() {this.state = 'closed';}
  }
  class Frame {
    constructor(canvas, options) {Object.assign(this, options); frames.push(this);}
    close() {this.closed = true;}
  }
  Object.assign(globalThis, {VideoEncoder: Encoder, VideoFrame: Frame});
  t.after(() => {for (const [key, descriptor] of descriptors) {if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];}});
  const progress = [];
  const blob = await encodeWebM({width: 3840, height: 2160, fps: 24, totalFrames: 12,
    renderFrame: () => ({width: 3840, height: 2160}), onProgress: value => progress.push(value)});
  assert.equal(blob.type, 'video/webm'); assert.equal(instance.peak, 1);
  assert.equal(instance.config.hardwareAcceleration, 'prefer-software'); assert.equal(instance.config.latencyMode, 'quality');
  assert.equal(progress.length, 12); assert.equal(progress.at(-1).completed, 12);
  assert.ok(frames.every(frame => frame.closed)); assert.equal(instance.state, 'closed');
  assert.equal(videoFrameWindow(1920, 1080), 4); assert.equal(videoFrameWindow(3840, 2160), 1);
});
