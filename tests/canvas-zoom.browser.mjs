import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {normalizeEditorSettings} from '../src/settings.mjs';

assert.equal(normalizeEditorSettings().canvasZoomGesture, 'ctrl-scroll');
assert.equal(normalizeEditorSettings({canvasZoomGesture:'invalid'}).canvasZoomGesture, 'ctrl-scroll');
const browser = await chromium.launch({channel:'chrome', headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const view = () => page.evaluate(() => ({...styk.state.view}));
const wheel = modifiers => page.evaluate(modifiers => {
  const viewport = document.querySelector('#viewport'), rect = viewport.getBoundingClientRect();
  viewport.dispatchEvent(new WheelEvent('wheel', {bubbles:true,cancelable:true,
    deltaY:40,clientX:rect.left+250,clientY:rect.top+200,...modifiers}));
}, modifiers);
try {
  await page.goto(process.env.STYK_URL || 'http://127.0.0.1:47831');
  await page.waitForFunction(() => window.styk?.ready);
  let before = await view();
  await wheel({});
  let after = await view();
  assert.equal(after.scale,before.scale);
  assert.equal(after.y,before.y-40);
  before = after;
  await wheel({shiftKey:true});
  after = await view();
  assert.equal(after.scale,before.scale);
  assert.equal(after.x,before.x-40);
  for (const modifiers of [{ctrlKey:true},{metaKey:true}]) {
    before = await view();
    await wheel(modifiers);
    after = await view();
    assert.ok(after.scale < before.scale);
    assert.ok(Math.abs((250-before.x)/before.scale-(250-after.x)/after.scale)<1e-8);
    assert.ok(Math.abs((200-before.y)/before.scale-(200-after.y)/after.scale)<1e-8);
  }
  await page.evaluate(() => styk.settingsUI.open('canvas'));
  const select = page.getByRole('combobox',{name:'Zoom gesture'});
  assert.equal(await select.inputValue(),'ctrl-scroll');
  await select.selectOption('scroll');
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/canvas-zoom-settings.png'});
  await page.evaluate(async () => { styk.settingsUI.close(); await styk.settingsUI.flush(); });
  for (const modifiers of [{},{ctrlKey:true},{metaKey:true}]) {
    before = await view();
    await wheel(modifiers);
    assert.ok((await view()).scale < before.scale);
  }
  await page.reload();
  await page.waitForFunction(() => window.styk?.ready);
  assert.equal(await page.evaluate(() => styk.state.settings.canvasZoomGesture),'scroll');
  before = await view();
  await wheel({});
  assert.ok((await view()).scale < before.scale);
  await page.evaluate(() => styk.settingsUI.open('canvas'));
  await select.selectOption('ctrl-scroll');
  await page.evaluate(() => styk.settingsUI.close());
  before = await view();
  await wheel({});
  assert.equal((await view()).scale,before.scale);
  assert.deepEqual(errors,[]);
  console.log('PASS: zoom modes, pan modifiers, pointer anchor, settings UI, reload persistence, and no page errors');
} finally {
  await browser.close();
}
