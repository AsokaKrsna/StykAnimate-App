import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('artifacts/bubble-startup');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47831');
  await page.waitForFunction(()=>window.styk?.ready);
  const snapshot=()=>page.evaluate(()=>({name:styk.editor.figure.name,frames:styk.editor.report.keyframes.length,objects:styk.editor.frame.objects.length,ticks:styk.editor.totalTicks,dirty:styk.editor.dirty}));
  const expected={name:'Bubble',frames:1,objects:1,ticks:1,dirty:false};
  assert.deepEqual(await snapshot(),expected);
  const render=async name=>{
    const png=await page.evaluate(async()=>{
      const {ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
      const r=new ExportFrameRenderer({width:960,height:540});
      try{await r.load(styk.editor.report);return (await r.renderTick(0)).toDataURL().split(',')[1];}finally{r.dispose();}
    });await writeFile(path.join(out,`${name}.png`),Buffer.from(png,'base64'));
  };
  await render('default');await page.screenshot({path:path.join(out,'editor.png')});
  // Exercise the actual canvas hit testing and pointer posing path at the wrist.
  const pointer=await page.evaluate(()=>{
    const e=styk.editor,p=e.geometry.objects.get(0).joints.get(4),r=document.querySelector('#viewport').getBoundingClientRect(),v=styk.state.view;
    return {x:r.x+v.x+p.x*v.scale,y:r.y+v.y+p.y*v.scale,angle:e.object.angles[3]};
  });
  await page.mouse.move(pointer.x,pointer.y);await page.mouse.down();
  await page.mouse.move(pointer.x+45,pointer.y-45,{steps:8});await page.mouse.up();
  assert.notEqual(await page.evaluate(()=>styk.editor.object.angles[3]),pointer.angle);
  await render('posed');
  await page.evaluate(()=>{styk.editor.undo();styk.editor.markSaved();styk.actions.new();});
  assert.deepEqual(await snapshot(),expected);
  const bytes=await page.evaluate(async()=>{
    const {DocumentExporter}=await import('/src/document-export.mjs');const x=new DocumentExporter();
    try{return Array.from(new Uint8Array(await(await x.export(styk.editor.report,{name:'Bubble'})).arrayBuffer()));}finally{x.dispose();}
  });const saved=path.join(out,'Bubble.styk');await writeFile(saved,Buffer.from(bytes));
  await page.locator('#file-input').setInputFiles(saved);await page.waitForFunction(()=>styk.editor.name==='Bubble');
  assert.deepEqual(await snapshot(),expected);await render('reopened');
  assert.deepEqual(errors,[]);await writeFile(path.join(out,'verification.json'),JSON.stringify({startup:true,new:true,pointerPosing:true,saveReopen:true,errors},null,2));
}finally{await browser.close();}
