import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackResources } from '../src/playback-resources.mjs';

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
