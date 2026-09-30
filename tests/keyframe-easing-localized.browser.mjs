import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {startBackend}=createRequire(import.meta.url)('../desktop/backend.cjs');
const backend=await startBackend({appRoot:fileURLToPath(new URL('..',import.meta.url))});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
// The easing popover's own wiring must not depend on English copy: translated labels once left its close button unfound.
try {
  await page.goto(backend.origin);await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(async()=>{const {emptyDocument,createFrame,createObject}=await import('/src/demo.mjs');const report=emptyDocument();report.keyframes=[0,60].map(x=>createFrame([createObject(report.figure_types[0],1,200+x,250)],12));styk.settingsUI.commit({timelineMode:'advanced'});styk.editor.load(report);styk.fit();styk.localization.setLocale('it');});
  await settle();
  const popover=page.locator('.styk-easing-popover'),keyAt=tick=>page.evaluate(tick=>styk.editor.report._styk.layerSheet.tracks['layer-1'].keys.find(key=>key.tick===tick),tick);
  const grid=page.locator('#timeline [role=grid]').first();
  const cell=async tick=>{const box=await grid.boundingBox(),{y,step,offset}=await page.evaluate(()=>{const t=styk.timeline;return {y:t.rowY(2)+t.rowSize(2)/2,step:t.pxPerTick,offset:t._offsetX()};});return [box.x+(tick+.5)*step-offset,box.y+y];};
  // Advanced layer timeline: double-clicking a key opens the popover, and a preset applies.
  await page.mouse.dblclick(...await cell(0));await popover.waitFor();
  await popover.locator('[role=radio]').nth(2).click();await settle();
  assert.equal(await popover.count(),0);
  assert.notEqual((await keyAt(0)).interpolation??'auto','auto');
  // The translated close button still closes it.
  await page.mouse.dblclick(...await cell(0));await popover.waitFor();
  await popover.locator('.styk-easing-header button').click();await settle();
  assert.equal(await popover.count(),0);
  // Simple filmstrip double-click takes the same path.
  await page.evaluate(()=>styk.settingsUI.commit({timelineMode:'simple'}));await settle();
  await page.locator('.sheet-preview').first().dblclick();await popover.waitFor();
  await popover.locator('.styk-easing-header button').click();await settle();
  assert.equal(await popover.count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: keyframe easing popover opens, applies and closes in a translated interface');
} finally {await page.evaluate(()=>styk.localization.setLocale('en')).catch(()=>{});await browser.close();backend.stop();}
