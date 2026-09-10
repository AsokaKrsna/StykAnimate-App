import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
const snap=()=>page.evaluate(()=>({tick:styk.editor.tick,duration:styk.editor.totalTicks,keys:styk.editor.layerFrameKeys('layer-1').map(k=>k.tick)}));
const cell=async tick=>{const box=await page.evaluate(tick=>{const t=styk.timeline,r=t.scroll.getBoundingClientRect();return{x:r.x+(tick+.5)*t.pxPerTick,y:r.y+32+(t.tracks.findIndex(l=>l.id==='layer-1')+.5)*32};},tick);await page.mouse.click(box.x,box.y);};
try {
 await page.goto(process.env.STYK_URL||'http://127.0.0.1:47831');await page.waitForFunction(()=>styk?.ready);
 await page.evaluate(async()=>{const {emptyDocument,createFrame,createObject}=await import('/src/demo.mjs');const r=emptyDocument();r.keyframes=[0,40].map(x=>createFrame([createObject(r.figure_types[0],1,200+x,250)],12));styk.editor.load(r);styk.editor.select(1);styk.fit();});
 await cell(5);const original=await snap();await page.keyboard.press('a');
 assert.deepEqual(await snap(),{...original,keys:[0,5,12]});
 await page.keyboard.press('a');assert.deepEqual(await snap(),{...original,keys:[0,5,12]});
 await cell(7);await page.locator('.sheet-frame-tools [data-hotkey-command="add-frame"]').click();assert.deepEqual((await snap()).keys,[0,5,7,12]);
 await page.locator('#viewport').focus();const before=await snap();
 await page.locator('.sheet-frame-tools [data-hotkey-command="add-frame"]').click();assert.deepEqual(await snap(),{tick:8,duration:before.duration+1,keys:[0,5,7,8,13]});
 await page.locator('.sheet-frame-tools [data-hotkey-command="add-frame"]').click();assert.equal((await snap()).tick,9);
 await page.keyboard.press('Control+z');assert.equal((await snap()).tick,8);await page.keyboard.press('Control+Shift+z');assert.equal((await snap()).tick,9);
 await cell(30);await page.keyboard.press('a');assert.equal((await snap()).tick,30);assert.ok((await snap()).keys.includes(30));
 await page.evaluate(()=>styk.editor.setLayerLocked('layer-1',true));const locked=await snap();await page.keyboard.press('a');assert.deepEqual(await snap(),locked);
 await page.evaluate(()=>styk.editor.setLayerLocked('layer-1',false));
 await page.locator('[data-app-menu="animation"]').click();assert.equal(await page.locator('#menu [data-action="add-frame"]').count(),1);assert.equal(await page.locator('#menu [data-action="blank-frame"],#menu [data-action="duplicate-frame-after"]').count(),0);await page.keyboard.press('Escape');
 await mkdir('artifacts/add-frame',{recursive:true});await page.screenshot({path:'artifacts/add-frame/advanced.png'});
 await page.evaluate(()=>{styk.settingsUI.commit({timelineMode:'simple'});styk.editor.seek(5);});const simple=await snap();await page.getByRole('button',{name:'Add Frame',exact:true}).click();assert.equal((await snap()).tick,6);assert.equal((await snap()).duration,simple.duration+1);
 await page.screenshot({path:'artifacts/add-frame/simple.png'});
 assert.deepEqual(errors,[]);console.log('PASS selected cells, repeated keys/buttons, canvas focus, undo/redo, beyond-end cells, locked layers, menus and simple mode');
}finally{await browser.close();}

