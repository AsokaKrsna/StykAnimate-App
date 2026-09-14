import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

await mkdir('artifacts/figure-palette',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!styk.state.editablePreparing&&styk.state.renderer.last?.report===styk.editor.report);};
const choose=async(selector,hex)=>{await page.locator(selector).click();const input=page.locator('.paint-picker [data-hex]');await input.fill(hex);await input.press('Tab');await page.locator('.paint-picker [data-close]').click();await settle();};
const palette=()=>page.evaluate(()=>styk.editor.figurePalette().map(entry=>[entry.color,entry.segments.length]));
try{
  await page.goto(process.env.STYK_URL??'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);
  const info=await page.evaluate(async path=>{
    let report;
    if(path)report=await (await fetch(path)).json();
    else{
      const {emptyDocument,createFrame,createObject}=await import('/src/demo.mjs');
      report=emptyDocument();report.version=4;report.frame_delay_ms=40;report.figure_types[0].segments.forEach(s=>s.color_rgb=[0,0,0]);
      report.keyframes=[createFrame([createObject(report.figure_types[0],1,320,250,{color_override_raw:196})])];
    }
    styk.editor.load(report);const uid=styk.editor.evaluatedFrame.objects[0].unique_id;styk.editor.select(uid);styk.actions['zoom-selection']();
    return {version:report.version,frames:report.keyframes.length,figures:report.figure_types.length,objects:styk.editor.evaluatedFrame.objects.length,uid,segments:styk.editor.figure.segments.length};
  },process.env.STYK_COLOR_CORPUS_JSON??null);
  await settle();assert.deepEqual(await palette(),[['#c40000',info.segments]]);
  await page.screenshot({path:'artifacts/figure-palette/hands-before.png'});
  await choose('#figure-color','44aacc');assert.deepEqual(await palette(),[['#44aacc',info.segments]]);
  await page.evaluate(uid=>styk.editor.select(uid,0),info.uid);await settle();
  await choose('#segment-color','eecc11');
  assert.deepEqual(await palette(),[['#44aacc',info.segments-1],['#eecc11',1]]);
  await page.evaluate(uid=>styk.editor.select(uid),info.uid);await settle();
  await page.locator('details[data-section="Color palette"] > summary').click();
  await choose('[data-palette-color="#44aacc"]','eecc11');assert.deepEqual(await palette(),[['#eecc11',info.segments]]);
  await page.evaluate(()=>styk.editor.undo());await settle();
  // The same open picker keeps editing its original members after a merge.
  await page.locator('[data-palette-color="#44aacc"]').click();
  for(const color of ['eecc11','778899']){await page.locator('.paint-picker [data-hex]').fill(color);await page.locator('.paint-picker [data-hex]').press('Tab');await settle();}
  await page.locator('.paint-picker [data-close]').click();
  assert.deepEqual(await palette(),[['#778899',info.segments-1],['#eecc11',1]]);
  const geometry=await page.evaluate(()=>styk.state.renderer.lastGeometry.objects.get(styk.editor.selectedSlot).segments.map(s=>s.rgb));
  assert.deepEqual(geometry[0],[238,204,17]);assert.ok(geometry.slice(1).every(rgb=>JSON.stringify(rgb)==='[119,136,153]'));
  await page.locator('.figure-palette-row').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/figure-palette/hands-palette.png'});
  await choose('#figure-color','9933ee');assert.deepEqual(await palette(),[['#9933ee',info.segments]]);
  await page.evaluate(()=>styk.editor.undo());await settle();
  assert.deepEqual(await palette(),[['#778899',info.segments-1],['#eecc11',1]]);
  assert.deepEqual(errors,[]);await writeFile('artifacts/figure-palette/browser-report.json',JSON.stringify({...info,palette:await palette(),errors},null,2));
  console.log('PASS visible figure/node/palette edits, merge, repeated picker edits, undo, and rendered geometry',info);
}finally{await browser.close();}
