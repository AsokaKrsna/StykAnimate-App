import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.STYK_INTEGRITY_ARTIFACTS||'artifacts/drawing-integrity';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);
  await page.locator('[data-workspace-mode="draw"]').click();await page.locator('[data-draw-action="new"]').first().click();
  await page.evaluate(()=>{styk.state.settings.autosaveSeconds=0;});
  const rect=await page.locator('#viewport').boundingBox(),x=rect.x+rect.width*.25,y=rect.y+rect.height*.4;
  for(const command of ['a','copy']){
    await page.evaluate(()=>{const d=styk.drawing;window.deliver=d.strokeMessage.bind(d);window.done=null;d.strokeMessage=data=>{if(data.kind==='done')window.done=data;else deliver(data);};window.source=styk.editor.prepareDrawingCel();window.beforeTick=styk.editor.tick;});
    await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>!!styk.drawing.gesture);await page.mouse.move(x+100,y,{steps:10});
    await page.evaluate(()=>{window.source=styk.drawing.gesture.target;});await page.mouse.up();await page.waitForFunction(()=>!!window.done);
    if(command==='a')await page.keyboard.press('a');else await page.getByRole('button',{name:'Next copied drawing',exact:true}).click();
    check(`${command} waits for the closing stroke`,await page.evaluate(()=>styk.editor.tick===beforeTick));
    await page.evaluate(()=>{styk.drawing.strokeMessage=deliver;deliver(done);});await page.waitForFunction(()=>styk.editor.tick>beforeTick);
    check(`${command} preserves the previous cel`,await page.evaluate(()=>styk.drawing.owner.entry(source.figure).store.bounds?.width>0));
    if(command==='copy')check('next copy contains the completed stroke',await page.evaluate(async()=>{const t=styk.editor.drawingTarget(),s=await styk.drawing.owner.surface(t.figure);return s.store.bounds?.width>0;}));
  }
  const saved=await page.evaluate(async()=>{
    const {Editor}=await import('/src/editor.mjs'),{DocumentExporter}=await import('/src/document-export.mjs'),{ImportClient}=await import('/src/import-client.mjs'),{decodeTileBlob}=await import('/src/drawing-tile-codec.mjs');
    const e=new Editor({demo:false,layerTimeline:true});e.createDrawingLayer();const t=e.prepareDrawingCel(),o=e.drawingResources;await o.surface(t.figure);
    e.commitDrawingPixels(t,[{tx:-300,ty:0,before:null,after:new Uint8ClampedArray([1,2,3,255])},{tx:300,ty:300,before:null,after:new Uint8ClampedArray([4,5,6,255])}]);
    const exporter=new DocumentExporter();try{const blob=await exporter.export(e.report,{format:'styk',getRevision:()=>e.revision}),read=await new ImportClient().importFile(new File([blob],'wide.styk'));
      const restored=new Editor({demo:false,layerTimeline:true});restored.load(read.document);const tiles=await decodeTileBlob(restored.drawingTarget().figure.image_assets[0].styk_tiles);return tiles.map(t=>({tx:t.tx,ty:t.ty,pixel:[...t.pixels.slice(0,4)]}));
    }finally{exporter.dispose();o.dispose();}
  });
  assert.deepEqual(saved,[{tx:-300,ty:0,pixel:[1,2,3,255]},{tx:300,ty:300,pixel:[4,5,6,255]}]);check('distant sparse marks survive a real STYK save and reopen',true);
  await page.screenshot({path:output+'/workspace.png'});
  check('no uncaught browser errors',errors.length===0);await writeFile(output+'/result.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
