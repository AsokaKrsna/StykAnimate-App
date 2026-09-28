// Desktop check of the public library against a local copy of the website's
// catalogue (build it first: node scripts/build-public-library.mjs). Browses
// the Public library, inserts with one undo step, saves into My library, opens
// a stykanimate://library link and drags a card onto the canvas.
import {_electron as electron} from '../tests/support/playwright.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), catalogDir = path.resolve(process.argv[2] ?? 'artifacts/public-library');
await readFile(path.join(catalogDir, 'catalog.json')).catch(() => { throw new Error(`No catalogue in ${catalogDir}. Run node scripts/build-public-library.mjs first.`); });
const run = path.join(root, 'artifacts', `public-library-${Date.now()}`), profile = path.join(run, 'profile'), library = path.join(run, 'library');
await mkdir(profile, {recursive: true});
await writeFile(path.join(profile, 'telemetry-state.json'), JSON.stringify({decided: true, consent: {analytics: false, diagnostics: false, policyVersion: '2026-09-10', updatedAt: Date.now()}}));
const requests = [];
// The website layout: /library/catalog.json, /library/files/…, /library/previews/…
const server = createServer(async (request, response) => {
  requests.push(request.url);
  const relative = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/library\//, '');
  if (relative.includes('..')) { response.writeHead(400).end(); return; }
  try { const bytes = await readFile(path.join(catalogDir, relative)); response.writeHead(200, {'content-length': bytes.length}).end(bytes); }
  catch { response.writeHead(404).end(); }
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
  await page.getByRole('button', {name: 'Public library', exact: true}).click();
  await page.locator('[data-public-id="folding-fan"] img').waitFor();
  const catalog = JSON.parse(await readFile(path.join(catalogDir, 'catalog.json'), 'utf8'));
  check('the public library lists every catalogue asset, grouped by pack', await page.locator('.library-card[data-public-id]').count() === catalog.items.length && await page.locator('.library-group').count() === catalog.packs.length);
  await page.waitForFunction(() => [...document.querySelectorAll('.library-card[data-public-id]')].slice(0, 4).every(card => card.classList.contains('is-loaded')));
  check('previews arrive from the website as images', await page.locator('[data-public-id="folding-fan"] img').evaluate(image => image.naturalWidth === 320));
  await page.screenshot({path: path.join(run, 'public-light.png')});
  await page.evaluate(async () => (await import('/src/theme.mjs')).applyEditorTheme('dark'));
  await page.screenshot({path: path.join(run, 'public-dark.png')});
  await page.evaluate(async () => (await import('/src/theme.mjs')).applyEditorTheme('light'));

  const before = await page.evaluate(() => ({count: window.styk.editor.selectionFrame.objects.length, undo: window.styk.editor._undo.length}));
  await page.locator('[data-public-id="folding-fan"]').dblclick();
  await page.waitForFunction(count => !window.styk.library.busy && window.styk.editor.selectionFrame.objects.length === count + 1, before.count);
  check('double-click inserts the verified public asset in one undo step', await page.evaluate(() => window.styk.editor.figure.name) === 'Folding fan' && await page.evaluate(() => window.styk.editor._undo.length) === before.undo + 1);
  await page.evaluate(() => window.styk.editor.undo());
  check('undo removes the inserted asset', await page.evaluate(() => window.styk.editor.selectionFrame.objects.length) === before.count);

  // Menus close when the list scrolls, so bring the card into view first.
  await page.locator('[data-public-id="solid-box-3d"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
  await page.locator('[data-public-id="solid-box-3d"]').click({button: 'right'});
  await page.getByRole('menuitem', {name: 'Save to My library', exact: true}).click();
  await page.waitForFunction(() => /saved to My library/.test(document.querySelector('.library-message').textContent));
  check('Save to My library writes the file with its preview sidecar', (await readFile(path.join(library, 'Box.stkz'))).length === catalog.items.find(item => item.id === 'solid-box-3d').size && (await readFile(path.join(library, 'Box.stkz.png'))).length > 100);
  await page.getByRole('button', {name: 'My library', exact: true}).click();
  await page.locator('[data-library-path="Box.stkz"] img').waitFor();
  check('the saved asset appears in My library with its preview');

  await page.evaluate(() => { document.querySelector('.library-content').scrollTop = 0; });
  await app.evaluate(({app}) => app.emit('second-instance', {}, ['StykAnimate.exe', 'stykanimate://library/glass-cube-3d']));
  await page.waitForFunction(() => window.styk.library.source === 'public' && document.activeElement?.dataset.publicId === 'glass-cube-3d');
  check('a stykanimate://library link opens the asset selected in the Public library', await page.locator('[data-public-id="glass-cube-3d"][aria-selected="true"]').isVisible());
  await app.evaluate(({app}) => app.emit('second-instance', {}, ['StykAnimate.exe', 'stykanimate://library/..%2Fsecret']));
  await page.waitForTimeout(300);
  check('malformed library links are ignored', await page.evaluate(() => window.styk.library.publicSelected) === 'glass-cube-3d');

  const card = await page.locator('[data-public-id="glass-cube-3d"]').boundingBox(), stage = await page.locator('#viewport').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + 30); await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, {steps: 12});
  await page.waitForSelector('.library-drop-target'); await page.mouse.up();
  await page.waitForFunction(count => !window.styk.library.busy && window.styk.editor.selectionFrame.objects.length === count + 1, before.count);
  check('dragging a public card onto the canvas inserts it', await page.evaluate(() => window.styk.editor.figure.name) === 'Glass cube');
  check('only the catalogue, previews and chosen files were requested', requests.every(url => /^\/library\/(catalog\.json|previews\/[a-z0-9-]+\.png|files\/[a-z0-9-]+\.stkz)$/.test(url)));
  assert.deepEqual(errors, []); check('no browser errors');
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify({checks, requests: requests.length, errors}, null, 2));
  console.log(JSON.stringify({run, checks: checks.length}, null, 2));
} catch (error) { await page?.screenshot({path: path.join(run, 'failure.png')}).catch(() => {}); console.error(await page?.locator('.library-message').innerText().catch(() => '')); throw error; }
finally { if (app) await app.evaluate(({app}) => app.exit(0)).catch(() => {}); server.close(); }
