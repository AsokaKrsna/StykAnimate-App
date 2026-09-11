import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPNG, rawPNG} from './preview-png-fixture.mjs';
import {pngInfo, samplePNG, fitImage} from '../src/preview-image.mjs';

test('PNG previews and native crops retain exact source pixels with bounded output', async () => {
  const blob = new Blob([await previewPNG(128, 64)]), info = await pngInfo(blob);
  assert.equal(info.width, 128); assert.equal(info.height, 64);
  const pixels = await samplePNG(blob, info, 8, 4);
  assert.equal(pixels.length, 128);
  assert.deepEqual([...pixels.slice(0, 4)], [230,70,90,255]);
  assert.deepEqual([...pixels.slice(28, 32)], [35,180,90,255]);
  const crop = await samplePNG(blob, info, 4, 4, {crop: {x: 80, y: 20, width: 4, height: 4}});
  assert.deepEqual([...crop.slice(0, 4)], [35,180,90,255]);
});

test('streamed decoding yields and can be cancelled without completing an image', async () => {
  const blob = new Blob([await previewPNG(128, 512)]), info = await pngInfo(blob); let checks = 0;
  await assert.rejects(samplePNG(blob, info, 16, 64, {check() {if (++checks > 8) throw new DOMException('Cancelled', 'AbortError');}}), {name: 'AbortError'});
});

test('preview dimensions preserve proportions and both allocation limits', () => {
  assert.deepEqual(fitImage(8192, 4096, 512 * 256, 4096), {width: 512, height: 256});
  assert.deepEqual(fitImage(8192, 1, 128, 64), {width: 64, height: 1});
});

test('all five PNG scanline filters reconstruct colour and alpha exactly', async () => {
  const width = 7, height = 5, expected = Uint8Array.from({length: width * height * 4}, (_, i) => (i * 31 + Math.floor(i / 7) * 17) % 256);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = y;
    for (let x = 0; x < width * 4; x++) {
      const i = y * width * 4 + x, a = x >= 4 ? expected[i - 4] : 0, b = y ? expected[i - width * 4] : 0, c = y && x >= 4 ? expected[i - width * 4 - 4] : 0;
      const prediction = a + b - c, distances = [a,b,c].map(n => Math.abs(prediction - n));
      const p = [a,b,c][distances.indexOf(Math.min(...distances))];
      const filter = [0, a, b, Math.floor((a + b) / 2), p][y];
      raw[y * (width * 4 + 1) + x + 1] = (expected[i] - filter + 256) % 256;
    }
  }
  const blob = new Blob([rawPNG({width, height, raw})]);
  assert.deepEqual([...await samplePNG(blob, await pngInfo(blob), width, height)], [...expected]);
});

test('packed palette transparency and 16-bit grayscale retain their native values', async () => {
  const palette = new Blob([rawPNG({width: 4, height: 1, depth: 1, color: 3, raw: Buffer.from([0, 0b01010000]),
    palette: Buffer.from([255,20,0, 0,30,255]), alpha: Buffer.from([255,0])})]);
  assert.deepEqual([...await samplePNG(palette, await pngInfo(palette), 4, 1)], [255,20,0,255, 0,30,255,0, 255,20,0,255, 0,30,255,0]);
  const gray = new Blob([rawPNG({width: 2, height: 1, depth: 16, color: 0, raw: Buffer.from([0, 128,128, 255,255]), alpha: Buffer.from([255,255])})]);
  assert.deepEqual([...await samplePNG(gray, await pngInfo(gray), 2, 1)], [128,128,128,255, 255,255,255,0]);
});
