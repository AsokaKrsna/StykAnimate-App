// Desktop check of the community library against a stand-in for the website's
// API (the routes of worker/library.js: /api/v1/content, the versioned index,
// the counting download route and the public files). Browses the Community
// library, inserts with one undo step, saves into My library (the WebP poster
// becomes a PNG preview), opens a stykanimate://library link and drags a card
// onto the canvas. Nothing leaves the machine.
import {_electron as electron} from '../tests/support/playwright.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {RIG_EXAMPLES, rigExampleDocument} from '../src/rig-examples.mjs';
import {buildContainerV2} from '../src/native-container.mjs';
import {validateScene} from '../src/pivot/model.mjs';

const root = process.cwd();
const run = path.join(root, 'artifacts', `public-library-${Date.now()}`), profile = path.join(run, 'profile'), library = path.join(run, 'library');
await mkdir(profile, {recursive: true});
await writeFile(path.join(profile, 'telemetry-state.json'), JSON.stringify({decided: true, consent: {analytics: false, diagnostics: false, policyVersion: '2026-09-10', updatedAt: Date.now()}}));

// What people upload: real figures from the rig examples, with a WebP poster like the website's.
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const VERSION = 1790000000000;
const uploads = [
  {id: 'fanfan1234', rig: 'folding-fan', category: 'props', author: 'Kim'},
  {id: 'boxbox1234', rig: 'solid-box-3d', category: 'props', author: 'Ana'},
  {id: 'cubecube12', rig: 'glass-cube-3d', category: 'effects', author: 'Lee'},
];
const items = [];
for (const upload of uploads) {
  const example = RIG_EXAMPLES.find(entry => entry.id === upload.rig), document = rigExampleDocument(upload.rig); validateScene(document);
  const bytes = Buffer.from(await buildContainerV2(document, 'stkz'));
  upload.bytes = bytes;
  items.push({id: upload.id, k: 'figure', c: upload.category, t: example.name, d: `${example.name} from the community.`, g: [upload.rig], a: upload.author, s: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), f: `i/${upload.id}/${upload.rig}.stkz`, p: null, i: `i/${upload.id}/poster.webp`, w: 500, h: 500, m: '#478480', dl: 0, lk: 0, ft: 0, at: 1});
}
const objects = new Map(uploads.flatMap(upload => [[`/api/v1/library/f/i/${upload.id}/${upload.rig}.stkz`, upload.bytes], [`/api/v1/library/f/i/${upload.id}/poster.webp`, WEBP]]));

const requests = [], counted = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  requests.push(`${url.pathname}${url.search}`);
  const json = value => response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(value));
  if (url.pathname === '/api/v1/content') return json({content: {}, library: {v: VERSION, count: items.length, downloads: 0, paused: false, base: null}});
  if (url.pathname === `/api/v1/library/index/${VERSION}`) return json({version: VERSION, downloads: 0, items});
  const download = /^\/api\/v1\/library\/get\/([a-z0-9]{10})$/.exec(url.pathname);
  if (download) { counted.push(download[1]); return response.writeHead(302, {location: `/api/v1/library/f/${url.searchParams.get('k')}`}).end(); }
  const object = objects.get(url.pathname);
  if (object) return response.writeHead(200, {'content-length': object.length}).end(object);
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${server.address().port}`;
const checks = [], errors = [], check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS', name); };
let app, page;
try {
  app = await electron.launch({args: [root], cwd: root, timeout: 45000, env: {...process.env, STYK_USER_DATA_DIR: profile, STYK_LIBRARY_DIR: library, STYK_PUBLIC_LIBRARY_URL: site}});
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.styk?.ready);
  const welcome = page.getByRole('button', {name: 'Close welcome screen'}); if (await welcome.isVisible()) await welcome.click();
  await page.getByRole('tab', {name: 'Library', exact: true}).click();
  await page.getByRole('button', {name: 'Community library', exact: true}).click();
  await page.locator('[data-public-id="fanfan1234"] img').waitFor();
  check('the community library lists every upload, grouped by category', await page.locator('.library-card[data-public-id]').count() === items.length
    && (await page.locator('.library-group-label > span:first-child').allTextContents()).join('|') === 'Effects|Props');
  await page.waitForFunction(() => [...document.querySelectorAll('.library-card[data-public-id]')].every(card => card.classList.contains('is-loaded')));
  check('posters arrive from the website as images', await page.locator('[data-public-id="fanfan1234"] img').evaluate(image => image.naturalWidth > 0));
  await page.screenshot({path: path.join(run, 'community-light.png')});
  await page.evaluate(async () => (await import('/src/theme.mjs')).applyEditorTheme('dark'));
  await page.screenshot({path: path.join(run, 'community-dark.png')});
  await page.evaluate(async () => (await import('/src/theme.mjs')).applyEditorTheme('light'));

  const before = await page.evaluate(() => ({count: window.styk.editor.selectionFrame.objects.length, undo: window.styk.editor._undo.length}));
  await page.locator('[data-public-id="fanfan1234"]').dblclick();
  await page.waitForFunction(count => !window.styk.library.busy && window.styk.editor.selectionFrame.objects.length === count + 1, before.count);
  check('double-click inserts the verified community asset in one undo step', await page.evaluate(() => window.styk.editor.figure.name) === 'Folding fan' && await page.evaluate(() => window.styk.editor._undo.length) === before.undo + 1);
  await page.evaluate(() => window.styk.editor.undo());
  check('undo removes the inserted asset', await page.evaluate(() => window.styk.editor.selectionFrame.objects.length) === before.count);

  // Menus close when the list scrolls, so bring the card into view first.
  await page.locator('[data-public-id="boxbox1234"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
  await page.locator('[data-public-id="boxbox1234"]').click({button: 'right'});
  await page.getByRole('menuitem', {name: 'Save to My library', exact: true}).click();
  await page.waitForFunction(() => /saved to My library/.test(document.querySelector('.library-message').textContent));
  const saved = await readFile(path.join(library, 'Box.stkz')), preview = await readFile(path.join(library, 'Box.stkz.png'));
  check('Save to My library writes the verified file', saved.equals(uploads[1].bytes));
  check('the WebP poster is kept as a real PNG preview', preview.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && preview.length > 50);
  await page.getByRole('button', {name: 'My library', exact: true}).click();
  await page.locator('[data-library-path="Box.stkz"] img').waitFor();
  check('the saved asset appears in My library with its preview');

  await page.evaluate(() => { document.querySelector('.library-content').scrollTop = 0; });
  await app.evaluate(({app}) => app.emit('second-instance', {}, ['StykAnimate.exe', 'stykanimate://library/cubecube12']));
  await page.waitForFunction(() => window.styk.library.source === 'public' && document.activeElement?.dataset.publicId === 'cubecube12');
  check('a stykanimate://library link opens the asset selected in the community library', await page.locator('[data-public-id="cubecube12"][aria-selected="true"]').isVisible());
  await app.evaluate(({app}) => app.emit('second-instance', {}, ['StykAnimate.exe', 'stykanimate://library/..%2Fsecret']));
  await page.waitForTimeout(300);
  check('malformed library links are ignored', await page.evaluate(() => window.styk.library.publicSelected) === 'cubecube12');

  const card = await page.locator('[data-public-id="cubecube12"]').boundingBox(), stage = await page.locator('#viewport').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + 30); await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, {steps: 12});
  await page.waitForSelector('.library-drop-target'); await page.mouse.up();
  await page.waitForFunction(count => !window.styk.library.busy && window.styk.editor.selectionFrame.objects.length === count + 1, before.count);
  check('dragging a community card onto the canvas inserts it', await page.evaluate(() => window.styk.editor.figure.name) === 'Glass cube');
  check('each asset that was taken counted as one download, and browsing counted none', JSON.stringify([...counted].sort()) === JSON.stringify(['boxbox1234', 'cubecube12', 'fanfan1234']));
  check('only the API routes were requested', requests.every(url => /^\/api\/v1\/(content|library\/(index\/\d+|get\/[a-z0-9]{10}\?k=i%2F[a-z0-9]{10}%2F[\w.-]+|f\/i\/[a-z0-9]{10}\/[\w.-]+))$/.test(url)));
  assert.deepEqual(errors, []); check('no browser errors');
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify({checks, requests: requests.length, counted, errors}, null, 2));
  console.log(JSON.stringify({run, checks: checks.length}, null, 2));
} catch (error) { await page?.screenshot({path: path.join(run, 'failure.png')}).catch(() => {}); console.error(await page?.locator('.library-message').innerText().catch(() => '')); throw error; }
finally { if (app) await app.evaluate(({app}) => app.exit(0)).catch(() => {}); server.close(); }
