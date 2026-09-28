import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildWeb, markCodecMode, selectFiles, webFilter, PYODIDE_FILES} from '../scripts/build-web.mjs';
import {verifyWeb, relativeReferences, LIMITS} from '../scripts/verify-web.mjs';
import {parseHeaders, headersFor, startWebServer} from '../scripts/serve-web.mjs';

const root = path.resolve(import.meta.dirname, '..');
let shared;
async function site(t) {
  shared ??= await mkdtemp(path.join(os.tmpdir(), 'styk-web-unit-')).then(async directory => ({directory, ...(await buildWeb({output: path.join(directory, 'site')}))}));
  const copy = await mkdtemp(path.join(os.tmpdir(), 'styk-web-copy-'));
  await cp(shared.output, copy, {recursive: true});
  t.after(() => rm(copy, {recursive: true, force: true}));
  return copy;
}
test.after(() => shared && rm(shared.directory, {recursive: true, force: true}));

test('the site ships exactly what the desktop app ships, plus the codec', async t => {
  const {filter} = await webFilter(root);
  const desktop = await selectFiles(root, filter);
  const built = await site(t);
  const missing = [];
  for (const file of desktop) { try { await readFile(path.join(built, file)); } catch { missing.push(file); } }
  assert.deepEqual(missing, [], 'every desktop web resource is in the site');
  for (const name of PYODIDE_FILES) assert.ok((await readFile(path.join(built, 'vendor', 'pyodide', name))).length > 0, name);
  assert.match(await readFile(path.join(built, 'vendor', 'pyodide', 'NOTICE.txt'), 'utf8'), /Mozilla Public License/);
});

test('the built site passes verification, and each kind of mistake is caught', async t => {
  const built = await site(t);
  assert.deepEqual((await verifyWeb(built)).problems, []);

  await rm(path.join(built, 'src', 'codec-request.mjs'));
  assert.ok((await verifyWeb(built)).problems.some(problem => /codec-request\.mjs, which is not in the site/.test(problem)), 'a missing module');

  await writeFile(path.join(built, 'index.html'), '<html><head></head><body></body></html>');
  assert.ok((await verifyWeb(built)).problems.some(problem => /in-browser codec/.test(problem)), 'a page without the codec marker');

  await mkdir(path.join(built, 'backend'), {recursive: true});
  await writeFile(path.join(built, 'backend', 'server.py'), '');
  await writeFile(path.join(built, '.env'), 'SECRET=1');
  const problems = (await verifyWeb(built)).problems.join('\n');
  assert.match(problems, /backend\/server\.py must not be part of the public site/);
  assert.match(problems, /\.env must not be part of the public site/);

  await writeFile(path.join(built, '_headers'), '/*\n  X-Only: this\n');
  assert.ok((await verifyWeb(built)).problems.some(problem => /Content-Security-Policy/.test(problem)), 'a site without a script policy');
});

test('oversized files are reported against the Cloudflare limit', async t => {
  const built = await site(t);
  await writeFile(path.join(built, 'huge.bin'), Buffer.alloc(LIMITS.fileBytes + 1));
  assert.ok((await verifyWeb(built)).problems.some(problem => /huge\.bin is 25\.0 MiB/.test(problem)));
});

test('module references are found in every import form and ignored in comments', () => {
  const source = `
    import a from './a.mjs';
    import {b,
      c} from "../b/c.mjs";
    export * from './d.mjs';
    export {e} from './e.mjs';
    const f = await import('./f.mjs');
    const worker = new Worker(new URL('./w.mjs', import.meta.url), {type: 'module'});
    const dir = new URL('../vendor/pyodide/', import.meta.url);
    // import ignored from './commented.mjs';
    /* import alsoIgnored from './block.mjs'; */
    import remote from 'https://example.com/x.mjs';
    import bare from 'node:fs';`;
  assert.deepEqual(relativeReferences(source).sort(), ['../b/c.mjs', '../vendor/pyodide/', './a.mjs', './d.mjs', './e.mjs', './f.mjs', './w.mjs']);
});

test('the index page is marked once, in the head', () => {
  const marked = markCodecMode('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  assert.equal(marked.match(/styk-codec/g).length, 1);
  assert.ok(marked.indexOf('styk-codec') < marked.indexOf('charset'));
  assert.equal(markCodecMode(marked), marked, 'marking twice changes nothing');
  assert.throws(() => markCodecMode('<html></html>'), /no <head>/);
});

test('_headers rules match like Cloudflare: splats, joined values, comments', () => {
  const rules = parseHeaders('# comment\n/*\n  X-A: one\n\n/src/*\n  X-A: two\n  Cache-Control: no-cache\n/exact\n  X-B: yes\n');
  assert.deepEqual(headersFor(rules, '/src/app.mjs').map(({name, value}) => [name, value]), [['X-A', 'one, two'], ['Cache-Control', 'no-cache']]);
  assert.deepEqual(headersFor(rules, '/exact').map(({name}) => name), ['X-A', 'X-B']);
  assert.deepEqual(headersFor(rules, '/other').map(({name}) => name), ['X-A']);
  assert.throws(() => parseHeaders('  Orphan: header\n'), /Invalid _headers line/);
});

test('the preview server applies _headers, revalidates with ETags, and stays inside the site', async t => {
  const built = await site(t);
  const server = await startWebServer({root: built});
  t.after(server.close);
  const page = await fetch(server.origin + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const module = await fetch(server.origin + '/src/app.mjs');
  assert.match(module.headers.get('content-type'), /text\/javascript/);
  const again = await fetch(server.origin + '/src/app.mjs', {headers: {'If-None-Match': module.headers.get('etag')}});
  assert.equal(again.status, 304);
  assert.equal((await fetch(server.origin + '/vendor/pyodide/pyodide.asm.wasm', {method: 'HEAD'})).headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(server.origin + '/missing.txt')).status, 404);
  assert.equal((await fetch(server.origin + '/..%2f..%2fetc/passwd')).status, 403);
});
