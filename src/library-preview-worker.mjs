import {drawGeometry} from './pivot/geometry.mjs';
import {objectBounds} from './renderer-geometry.mjs';
import {PlaybackResources} from './playback-resources.mjs';
import {decodeDocument, normalizeDecodedDocument} from './native-container.mjs';
import {libraryPreviewTimeline, libraryPreviewMatte, LIBRARY_MATTES} from './library-preview-core.mjs';

let animation;
const union = (a, b) => !a ? b : {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
  height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)};
function paint(canvas, geometry, resources, bounds) {
  const context = canvas.getContext('2d'), size = canvas.width;
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, size, size);
  const scale = size * .9 / Math.max(1, bounds.width, bounds.height);
  context.translate(size / 2, size / 2); context.scale(scale, scale);
  context.translate(-bounds.x - bounds.width / 2, -bounds.y - bounds.height / 2);
  drawGeometry(context, geometry, resources);
}
async function frame(elapsed = 0, first = false) {
  const {scene, resources, canvas} = animation, tick = Math.floor(elapsed * scene.fps) % scene.duration;
  const geometry = scene.geometry(tick); await resources.preload(geometry.drawables, {maxDimension: 512});
  if (geometry.drawables.length) animation.bounds = union(animation.bounds, objectBounds(geometry.drawables, resources));
  paint(canvas, geometry, resources, animation.bounds ?? {x: 0, y: 0, width: 1, height: 1});
  const matte = first ? animation.matte : undefined;
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({bitmap, tick, fps: scene.fps, duration: scene.duration, matte}, [bitmap]);
}
self.onmessage = async ({data}) => {
  if (data.operation === 'frame') { try { await frame(data.elapsed); } catch (error) { self.postMessage({error: error.message}); } return; }
  const {baseURL} = data;
  const resources = new PlaybackResources({baseURL, maxBytes: 8 * 1024 * 1024, preview: true});
  try {
    let report = data.report;
    if (data.file) {
      const kind = data.file.name.toLowerCase().endsWith('.stykmov') ? 'stykmov' : 'stkz';
      report = normalizeDecodedDocument((await decodeDocument(new Uint8Array(await data.file.arrayBuffer()), kind)).document, kind);
    }
    const scene = libraryPreviewTimeline(report);
    if (data.operation === 'animation') {
      animation = {scene, resources, canvas: new OffscreenCanvas(320, 320), bounds: null};
      // Fit sampled motion and choose one matte across its colors. Only bounded
      // geometry caches are retained; there is no rendered-frame cache.
      const started = performance.now(), sample = new OffscreenCanvas(40, 40), pixels = [];
      for (let i = 0; i < 16; i++) {
        const geometry = scene.geometry(i * (scene.duration - 1) / 15);
        if (geometry.drawables.length) {
          await resources.preload(geometry.drawables, {maxDimension: 512});
          const bounds = objectBounds(geometry.drawables, resources); animation.bounds = union(animation.bounds, bounds);
          paint(sample, geometry, resources, bounds); pixels.push(sample.getContext('2d').getImageData(0, 0, 40, 40).data);
        }
        if (performance.now() - started > 250) break;
      }
      const colors = new Uint8Array(pixels.length * 40 * 40 * 4); pixels.forEach((data, i) => colors.set(data, i * 40 * 40 * 4));
      animation.matte = LIBRARY_MATTES[libraryPreviewMatte(colors)];
      await frame(0, true); return;
    }
    let geometry = scene.geometry(0);
    // A clip may begin on an intentionally empty frame; find a useful poster.
    for (let i = 1; !geometry.drawables.length && i < 16; i++) geometry = scene.geometry(i * (scene.duration - 1) / 15);
    await resources.preload(geometry.drawables, {maxDimension: 512});
    const bounds = objectBounds(geometry.drawables, resources), size = 320;
    const canvas = new OffscreenCanvas(size, size); paint(canvas, geometry, resources, bounds);
    const blob = await canvas.convertToBlob({type:'image/png'});
    self.postMessage({blob});
  } catch (error) { self.postMessage({error: error.message}); }
  finally { if (animation?.resources !== resources) resources.dispose(); }
};
