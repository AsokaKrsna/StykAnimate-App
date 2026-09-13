import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackResources } from '../src/playback-resources.mjs';
import { previewPNG } from './preview-png-fixture.mjs';

test('preview raster routing bounds CPU fills and keeps image and export acceleration',()=>{
  const preview=new PlaybackResources({preview:true}),original=new PlaybackResources();
  try {
    assert.notEqual(preview.pathRasterSurfaces,preview.rasterSurfaces);
    assert.equal(preview.rasterSurface(512,512),preview.pathRasterSurfaces);
    assert.equal(preview.rasterSurface(513,512),preview.rasterSurfaces);
    assert.equal(preview.rasterSurface(20,20,{hasImages:true}),preview.rasterSurfaces);
    assert.equal(original.rasterSurface(20,20),original.rasterSurfaces);
  }finally{preview.dispose();original.dispose();}
});

function setup(t, sizes, maxBytes = 32) {
  const decoded = [];
  t.mock.method(globalThis, 'fetch', async url => ({
    ok: true, blob: async () => sizes[new URL(url).pathname.slice(1)],
  }));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  globalThis.createImageBitmap = async ([width, height]) => {
    const bitmap = { width, height, closed: 0, close() { this.closed++; } };
    decoded.push(bitmap);
    return bitmap;
  };
  const resources = new PlaybackResources({ baseURL: 'https://example.test/', maxBytes });
  t.after(() => {
    resources.dispose();
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else delete globalThis.createImageBitmap;
  });
  const preload = (...urls) => resources.preload(urls.map(url => ({ type: 'image', asset: { url } })));
  return { resources, decoded, preload };
}

test('an oversized image loads at original resolution and is released when no longer needed', async t => {
  const { resources, decoded, preload } = setup(t, { large: [8192, 8192], small: [2, 2] });
  await preload('large');
  assert.equal(resources.bytes, 8192 * 8192 * 4);
  assert.equal(resources.image('large').naturalWidth, 8192);
  assert.equal(resources.image('large').naturalHeight, 8192);
  assert.equal(decoded[0].closed, 0);
  await preload('small');
  assert.equal(decoded[0].closed, 1);
  assert.equal(resources.bytes, 16);
});

test('combined required assets may exceed the target, with duplicate URLs decoded once', async t => {
  const { resources, decoded, preload } = setup(t, { a: [3, 2], b: [3, 2] });
  await preload('a', 'b', 'a');
  assert.equal(resources.bytes, 48);
  assert.equal(decoded.length, 2);
  assert.ok(decoded.every(bitmap => bitmap.closed === 0));
  await preload('b');
  assert.equal(resources.bytes, 24);
  assert.equal(decoded[0].closed, 1);
  assert.equal(decoded[1].closed, 0);
  assert.equal(decoded.length, 2);
});

test('ordinary cache eviction and disposal still release bitmap memory', async t => {
  const { resources, decoded, preload } = setup(t, { a: [2, 2], b: [2, 2], c: [2, 2] });
  await preload('a', 'b');
  resources.image('a');
  await preload('c');
  assert.equal(decoded[1].closed, 1);
  assert.equal(decoded[0].closed, 0);
  assert.equal(resources.bytes, 32);
  resources.dispose();
  assert.equal(resources.bytes, 0);
  assert.ok(decoded.every(bitmap => bitmap.closed === 1));
  await assert.rejects(preload('a'), { name: 'AbortError' });
});

test('retained export images need neither another fetch nor another decode', async t => {
  const {resources,decoded,preload}=setup(t,{a:[2,2]},32);
  await preload('a');
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unnecessary source fetch');});
  for(let frame=0;frame<20;frame++)await preload('a');
  assert.equal(decoded.length,1);assert.equal(resources.bytes,16);
});

async function imageFixture(t, maxBytes) {
  const png = await previewPNG(1024, 512), url = 'data:image/png;base64,' + png.toString('base64');
  const decoded = [], previousBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
    previousImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
  globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  globalThis.createImageBitmap = async (source, sx, sy, sw, sh, options) => {
    const bitmap = { width: options?.resizeWidth ?? sw ?? source.width, height: options?.resizeHeight ?? sh ?? source.height, closed: 0, close() { this.closed++; } };
    decoded.push(bitmap); return bitmap;
  };
  const resources = new PlaybackResources({ maxBytes, hardMaxBytes: maxBytes });
  t.after(() => {
    resources.dispose();
    if (previousBitmap) Object.defineProperty(globalThis, 'createImageBitmap', previousBitmap); else delete globalThis.createImageBitmap;
    if (previousImageData) Object.defineProperty(globalThis, 'ImageData', previousImageData); else delete globalThis.ImageData;
  });
  // The full 2 MiB image exceeds the allowance; only its visible source crop
  // is needed. Anchored 1:1 at the document origin like a placed bitmap figure.
  const asset = { data_url: url, width: 1024, height: 512, display_width: 1024, display_height: 512,
    anchor_start: { x: 0, y: 0 }, anchor_length: 1024, anchor_angle_rad: 0 };
  const item = { type: 'image', asset, start: { x: 0, y: 0 }, end: { x: 1024, y: 0 }, angle: 0, seg: {}, obj: {} };
  return { resources, decoded, url, item };
}

test('export preloads decode only the needed source crop inside the allowance', async t => {
  const { resources, decoded, url, item } = await imageFixture(t, 1024 * 1024);
  await resources.preload([item], { plan: { matrix: [1, 0, 0, 1, 0, 0], width: 64, height: 64 } });
  const image = resources.image(url);
  assert.equal(image.naturalWidth, 1024);
  assert.ok(image.width <= 68 && image.height <= 68, `expected a bounded crop, decoded ${image.width}x${image.height}`);
  assert.equal(image.srcX, 0); assert.equal(image.srcY, 0);
  assert.ok(resources.bytes <= 1024 * 1024);
  // A shifted view grows coverage into one union variant instead of restarting.
  await resources.preload([item], { plan: { matrix: [1, 0, 0, 1, -32, -32], width: 64, height: 64 } });
  const shifted = resources.image(url);
  assert.ok(shifted.srcX <= 32 && shifted.srcX + shifted.srcW >= 96 && shifted.srcY <= 32 && shifted.srcY + shifted.srcH >= 96);
  assert.ok(decoded.every(bitmap => bitmap.width * bitmap.height * 4 <= 1024 * 1024));
  // Views that cannot show the image keep the variant without decoding.
  const count = decoded.length;
  await resources.preload([item], { plan: { matrix: [1, 0, 0, 1, -4096, 0], width: 64, height: 64 } });
  assert.equal(decoded.length, count);
});

test('preview variants cover unchanged and contained draws without redecoding', async t => {
  const { resources, decoded, url, item } = await imageFixture(t, 4 * 1024 * 1024);
  resources.preview = true;
  const visible = { x: 0, y: 0, width: 64, height: 64 };
  await resources.preload([item], { scale: 1, visible });
  const first = resources.image(url);
  assert.ok(first.srcW <= 68);
  await resources.preload([item], { scale: 1, visible });
  assert.equal(resources.image(url), first);
  await resources.preload([item], { scale: 1, visible: { x: 8, y: 8, width: 32, height: 32 } });
  assert.equal(resources.image(url), first, 'a contained view must not shrink the retained variant');
  assert.equal(decoded.length, 1);
  // A partially moved view grows coverage into one union variant.
  await resources.preload([item], { scale: 1, visible: { x: 48, y: 0, width: 64, height: 64 } });
  const grown = resources.image(url);
  assert.equal(decoded.length, 2);
  assert.ok(grown.srcX + grown.srcW >= 112 && grown.srcY + grown.srcH >= 66, 'the union variant must cover both views');
  assert.equal(first.closed, 1, 'the replaced variant releases its pixels');
});
