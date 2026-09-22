import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.STYK_PREPARATION_ARTIFACTS||'artifacts/drawing-preparation';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);await page.locator('[data-workspace-mode="draw"]').click();
  await page.evaluate(async()=>{
    const {emptyDocument}=await import('/src/demo.mjs');styk.state.settings.autosaveSeconds=0;
    window.startFixture=()=>{
      // Worker preparation serves the stroke worker and history replay; GPU
      // strokes prepare during read-back (tests/drawing-gpu.browser.mjs).
      const e=styk.editor,d=styk.drawing;e.load(emptyDocument());e.createDrawingLayer();d.tool='brush';d.gpuBrushDisabled=true;Object.assign(d.settings,{size:700,resolution:1,color:'#203ed8',hardness:1,opacity:1,pressureSize:false,pressureOpacity:false,stabilization:0});
      window.fixtureRevision=e.revision;window.fixtureUndo=e._undo.length;window.preparationHeld=false;window.barrierSettled=false;
      const request=d.owner.worker.request.bind(d.owner.worker);let held=false;
      d.owner.worker.request=async(kind,payload,options)=>{if(kind==='prepare-tiles'&&!held){held=true;window.preparationHeld=true;await new Promise(resolve=>window.releasePreparation=resolve);}return request(kind,payload,options);};
    };
    window.snapshot=()=>[...styk.drawing.owner.entry(styk.editor.drawingTarget().figure).store].map(t=>{let hash=2166136261;for(const v of t.pixels)hash=Math.imul(hash^v,16777619)>>>0;return[t.tx,t.ty,hash];});
    startFixture();
  });
  const rect=await page.locator('#viewport').boundingBox(),point={x:rect.x+rect.width*.45,y:rect.y+rect.height*.45};
  const dab=async()=>{await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.up();await page.waitForFunction(()=>window.preparationHeld);};
  await dab();
  check('a closing large stroke keeps its new-cel preview while the document is unchanged',await page.evaluate(()=>Boolean(styk.drawing.gesture?.session?.ended&&styk.drawing.renderPreview&&styk.drawing.operation)&&styk.editor.revision===fixtureRevision&&styk.editor._undo.length===fixtureUndo));
  await page.waitForFunction(async()=>{const image=new Image();image.src=document.querySelector('#scene').toDataURL();await image.decode();const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]<70&&rgba[i+1]<100&&rgba[i+2]>150)ink++;return ink>1000;});
  await page.screenshot({path:output+'/stroke-preparation.png'});check('the uncommitted stroke remains visibly painted during preparation',true);
  await page.evaluate(()=>{window.barrier=styk.drawing.barrier().then(()=>window.barrierSettled=true);});
  check('saving waits for the entire prepared stroke',await page.evaluate(()=>!barrierSettled));
  await page.evaluate(()=>releasePreparation());await page.evaluate(()=>barrier);
  check('the prepared stroke commits once and releases its operation and reservation',await page.evaluate(()=>styk.editor._undo.length===fixtureUndo+1&&!styk.drawing.operation&&!styk.drawing.gesture&&[...styk.drawing.owner.entries.values()].every(e=>!e.preparing)));
  await page.evaluate(async()=>{window.expected=snapshot();await styk.drawing.owner.history?.pumping;await styk.drawing.history('undo');window.redoRevision=styk.editor.revision;window.redoCommand=styk.editor._redo.at(-1);const d=styk.drawing,request=d.owner.worker.request.bind(d.owner.worker);let batches=0;d.owner.worker.request=(kind,payload,options)=>{const pending=request(kind,payload,options);if(kind==='prepare-tiles'&&++batches===2)d.cancel();return pending;};window.redoError=await d.history('redo').then(()=>null,error=>error.name);d.owner.worker.request=request;});
  check('Escape during real worker preparation leaves warm redo and its cursor untouched',await page.evaluate(()=>redoError==='AbortError'&&styk.editor.revision===redoRevision&&styk.editor._redo.at(-1)===redoCommand&&!styk.editor.drawingTarget().figure&&!styk.drawing.operation&&[...styk.drawing.owner.entries.values()].every(e=>!e.preparing)));
  await page.evaluate(()=>styk.drawing.history('redo'));
  check('retrying the cancelled redo restores every exact tile',await page.evaluate(()=>JSON.stringify(snapshot())===JSON.stringify(expected)));
  await page.evaluate(async()=>{await styk.drawing.barrier();startFixture();});await dab();await page.keyboard.press('Escape');await page.evaluate(()=>releasePreparation());await page.waitForFunction(()=>!styk.drawing.operation);
  check('Escape during a large stroke preparation restores the blank cel without adding history',await page.evaluate(()=>styk.editor.revision===fixtureRevision&&styk.editor._undo.length===fixtureUndo&&!styk.editor.drawingTarget().figure&&!styk.drawing.gesture&&[...styk.drawing.owner.entries.values()].every(e=>!e.preparing)));
  await page.evaluate(()=>startFixture());await dab();await page.evaluate(async()=>{const {emptyDocument}=await import('/src/demo.mjs');window.closedOwner=styk.drawing.owner;styk.editor.load(emptyDocument());releasePreparation();});await page.waitForFunction(()=>!styk.drawing.operation);
  check('replacing the document disposes a pending stroke preparation without publishing it',await page.evaluate(()=>closedOwner.disposed&&closedOwner.workingBytes===0&&!styk.drawing.gesture&&styk.editor.report.figure_types.every(f=>!f._styk?.drawing)));
  check('no uncaught browser errors',errors.length===0);await writeFile(output+'/preparation.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
