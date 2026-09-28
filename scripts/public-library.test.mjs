import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {PublicLibrary, parseCatalog, siteFrom} = require('../desktop/public-library.cjs');
const {LibraryStore} = require('../desktop/library-store.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEl0AAAAASUVORK5CYII=', 'base64');
const FILE = Buffer.from('native figure bytes');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const item = (id, extra = {}) => ({id, name: 'Folding fan', kind: 'figure', pack: 'mechanisms', file: `files/${id}.stkz`, preview: `previews/${id}.png`, size: FILE.length, sha256: sha(FILE), matte: 'light', ...extra});
const catalog = (items = [item('folding-fan')]) => ({format: 'stykanimate-public-library', version: 1, packs: [{id: 'mechanisms', name: 'Mechanisms'}], items});

/** A stand-in website: routes by path, records every request. */
function site(routes) {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({url, options});
    const route = routes[new URL(url).pathname];
    if (!route) return new Response('missing', {status: 404});
    const body = typeof route === 'function' ? route() : route;
    return new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), {status: 200});
  };
  return {fetcher, requests};
}

test('reads only the fixed website and keeps valid catalogue entries', async () => {
  const bad = [item('Bad Id'), item('wrong-file', {file: 'files/other.stkz'}), item('traversal', {preview: '../secret.png'}), item('no-hash', {sha256: 'x'}),
    item('huge', {size: 9 * 1024 * 1024}), item('orphan', {pack: 'missing'}), item('clip', {kind: 'movieclip'}), {id: 'folding-fan'}];
  const {fetcher, requests} = site({'/library/catalog.json': catalog([item('folding-fan'), ...bad, item('folding-fan', {name: 'Duplicate'})])});
  const library = new PublicLibrary({fetcher});
  const result = await library.catalog();
  assert.deepEqual(result.items.map(entry => entry.id), ['folding-fan']);
  assert.equal(result.items[0].name, 'Folding fan');
  assert.equal(result.page, 'https://stykanimate.com/library/');
  assert.equal(requests[0].url, 'https://stykanimate.com/library/catalog.json');
  assert.equal(requests[0].options.redirect, 'error');
  await library.catalog(); assert.equal(requests.length, 1, 'the catalogue is reused');
  await library.catalog({refresh: true}); assert.equal(requests.length, 2, 'refresh asks again');
});

test('rejects unknown formats, newer versions and overrides that are not loopback', () => {
  assert.throws(() => parseCatalog('{"format":"other","packs":[],"items":[]}'), /could not be read/);
  assert.throws(() => parseCatalog(JSON.stringify({...catalog(), version: 2})), /Update StykAnimate/);
  assert.throws(() => siteFrom('https://example.com'), /loopback/);
  assert.throws(() => siteFrom('http://example.com'), /loopback/);
  assert.equal(siteFrom('http://127.0.0.1:4173/anything'), 'http://127.0.0.1:4173');
  assert.equal(siteFrom(undefined), 'https://stykanimate.com');
});

test('verifies downloaded files against the catalogue and caches them', async () => {
  const {fetcher, requests} = site({'/library/catalog.json': catalog(), '/library/files/folding-fan.stkz': FILE, '/library/previews/folding-fan.png': PNG});
  const library = new PublicLibrary({fetcher});
  const asset = await library.asset('folding-fan');
  assert.equal(asset.name, 'Folding fan.stkz'); assert.equal(asset.extension, '.stkz'); assert.deepEqual(asset.bytes, FILE);
  await library.asset('folding-fan');
  assert.equal(requests.filter(request => request.url.endsWith('.stkz')).length, 1);
  assert.match(await library.preview('folding-fan'), /^data:image\/png;base64,/);
  await assert.rejects(library.asset('../catalog'), /Unknown/);
  await assert.rejects(library.asset('not-listed'), /no longer/);
  assert.equal(library.pageFor('folding-fan'), 'https://stykanimate.com/library/#folding-fan');
  assert.equal(library.pageFor('<bad>'), 'https://stykanimate.com/library/');
});

test('refuses tampered, oversized and non-PNG responses', async () => {
  const tampered = new PublicLibrary(site({'/library/catalog.json': catalog(), '/library/files/folding-fan.stkz': Buffer.from('native figure bytez')}));
  await assert.rejects(tampered.asset('folding-fan'), /did not match/);
  const oversized = new PublicLibrary(site({'/library/catalog.json': catalog(), '/library/files/folding-fan.stkz': Buffer.alloc(FILE.length + 1)}));
  await assert.rejects(oversized.asset('folding-fan'), /unexpectedly large/);
  const notPng = new PublicLibrary(site({'/library/catalog.json': catalog(), '/library/previews/folding-fan.png': 'not a png'}));
  await assert.rejects(notPng.preview('folding-fan'), /not a PNG/);
  const offline = new PublicLibrary({fetcher: async () => { throw new TypeError('fetch failed'); }});
  await assert.rejects(offline.catalog(), /Could not reach/);
});

test('a public asset saves into the library with its preview, never over an existing file', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'styk-public-')), store = new LibraryStore(path.join(root, 'library'));
  await store.init(); t.after(() => store.dispose());
  const thumbnail = `data:image/png;base64,${PNG.toString('base64')}`;
  const first = await store.saveBytes({name: 'Bamboo: tall', extension: '.stkz', kind: 'set', thumbnail, bytes: FILE});
  const second = await store.saveBytes({name: 'Bamboo: tall', extension: '.stkz', kind: 'set', thumbnail, bytes: FILE});
  assert.equal(first.path, 'Bamboo- tall.stkz'); assert.equal(second.path, 'Bamboo- tall (2).stkz');
  assert.deepEqual(await readFile(path.join(store.root, first.path)), FILE);
  assert.deepEqual(await readFile(path.join(store.root, `${first.path}.png`)), PNG);
  assert.equal((await store.list()).entries[0].kind, 'set');
});
