/** Pointwise whole-cel prototype, deliberately limited to unmasked invert.
 * Compares exact output, including hidden RGB on transparent pixels and COW.
 * This is kernel evidence, not a production filter or measured UI improvement.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {TileStore, TILE_BYTES} from '../src/drawing-tiles.mjs';
import {filterTiles} from '../src/drawing-pixels.mjs';

const output = process.argv[2] ?? 'artifacts/codebase-sweep/drawing-filters.json';
const rows = [];
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
function tileInvert(store) {
  for (const {tx, ty} of store) {
    const pixels = store.writable(tx, ty).pixels;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
      pixels[i] = 255 - pixels[i]; pixels[i + 1] = 255 - pixels[i + 1]; pixels[i + 2] = 255 - pixels[i + 2];
    }
  }
}
function digest(store) {
  const hash = createHash('sha256');
  for (const tile of [...store].sort((a, b) => a.ty - b.ty || a.tx - b.tx)) {
    hash.update(`${tile.tx},${tile.ty}:`); hash.update(tile.pixels);
  }
  return hash.digest('hex');
}
for (const kind of ['dense-1024', 'sparse-4096']) {
  const store = new TileStore(), columns = kind.startsWith('dense') ? 16 : 64;
  for (let y = 0; y < columns; y++) for (let x = 0; x < columns; x++) {
    if (columns === 64 && !((x % 8 === 0 && y % 8 === 0) || (x === 63 && y === 63))) continue;
    const pixels = new Uint8ClampedArray(TILE_BYTES);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([i % 251, (i * 7) % 251, 77, i % 20 ? 255 : 0], i);
    store.set(x, y, pixels);
  }
  const original = digest(store), samples = [];
  for (let pass = 0; pass < 6; pass++) for (const mode of pass % 2 ? ['tile-prototype', 'production'] : ['production', 'tile-prototype']) {
    const fork = store.fork(); globalThis.gc?.();
    const before = process.memoryUsage(), start = performance.now();
    if (mode === 'production') filterTiles(fork, {bounds: store.bounds, kind: 'invert'}); else tileInvert(fork);
    fork.prune();
    const elapsedMs = performance.now() - start, after = process.memoryUsage();
    samples.push({mode, pass, elapsedMs, arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers,
      tiles: fork.size, digest: digest(fork)});
    assert.equal(digest(store), original, 'Filtering a fork must preserve original pixels.');
  }
  assert.equal(new Set(samples.map(row => row.digest)).size, 1, 'Candidate pixels must match exactly.');
  const productionMs = median(samples.filter(row => row.mode === 'production' && row.pass).map(row => row.elapsedMs));
  const candidateMs = median(samples.filter(row => row.mode === 'tile-prototype' && row.pass).map(row => row.elapsedMs));
  rows.push({kind, bounds: store.bounds, tiles: store.size, residentBytes: store.bytes,
    productionMedianMs: productionMs, candidateMedianMs: candidateMs, kernelSpeedup: productionMs / candidateMs, samples});
}
const sourceHashes = {};
for (const name of ['src/drawing-pixels.mjs', 'src/drawing-tiles.mjs'])
  sourceHashes[name] = createHash('sha256').update(await readFile(name)).digest('hex');
await mkdir(path.dirname(output), {recursive: true});
await writeFile(output, JSON.stringify({at: new Date().toISOString(), node: process.version,
  cpu: os.cpus()[0].model, sourceHashes, rows,
  limitations: ['Unmasked whole-cel invert only. Other filters, blur, masks, publication, history encoding and UI latency are not measured.',
    'Six alternating samples, first pass excluded from medians; Node GC occurs outside timing. ArrayBuffer deltas are live-at-sample observations, not peak process memory.']}, null, 2));
console.log(JSON.stringify(rows.map(({samples, ...row}) => row)));
