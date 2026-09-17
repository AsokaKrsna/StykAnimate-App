import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve(process.env.STYK_STROKE_ARTIFACTS||'artifacts/drawing-stroke'),url=process.env.STYK_URL||'http://127.0.0.1:47839';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
try{
  await page.goto(url);await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(()=>{styk.state.settings.autosaveSeconds=0;window.__longtasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__longtasks.push(e.duration)}).observe({entryTypes:['longtask']});});
  await page.locator('[data-workspace-mode="draw"]').click();
  await page.locator('[data-draw-action="new"]').first().click();
  const rect=await page.locator('#viewport').boundingBox();
  const start={x:rect.x+rect.width*.2,y:rect.y+rect.height*.3},end={x:start.x+560,y:start.y+240};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));
  await page.evaluate(()=>window.__longtasks.length=0);
  const strokeStart=Date.now();
  await page.mouse.move(end.x,end.y,{steps:400});await page.mouse.up();
  await page.waitForFunction(()=>!styk.drawing.gesture);
  const wallMs=Date.now()-strokeStart;
  check('fast 400-sample stroke commits as one undo command',await page.evaluate(()=>styk.editor.undoLabel==='Brush stroke'));
  const stats=await page.evaluate(()=>({...styk.drawing.strokeStats}));
  check('rasterization ran off-thread in multiple paced batches',stats.batches>1);
  check('the main thread never exceeded a 50 ms long task while drawing',await page.evaluate(()=>window.__longtasks.length===0));
  const continuous=await page.evaluate(({sx,sy,ex,ey})=>{
    const d=styk.drawing,t=styk.editor.drawingTarget(),store=d.owner.entry(t.figure).store;
    const a=d.pixel({clientX:sx,clientY:sy},t),b=d.pixel({clientX:ex,clientY:ey},t);
    const near=(x,y)=>{for(let dy=-14;dy<=14;dy++)for(let dx=-14;dx<=14;dx++)if(store.pixel(Math.round(x)+dx,Math.round(y)+dy)[3]>100)return true;return false;};
    for(let i=0;i<=50;i++)if(!near(a.x+(b.x-a.x)*i/50,a.y+(b.y-a.y)*i/50))return false;
    return true;
  },{sx:start.x,sy:start.y,ex:end.x,ey:end.y});
  check('committed cel has continuous ink along the whole path',continuous);
  // A quick tap still lands exactly one dab and commits as its own undo.
  const tapRevision=await page.evaluate(()=>styk.editor.revision);
  await page.mouse.move(end.x+40,end.y);await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(r=>styk.editor.revision!==r,tapRevision);
  check('a quick tap after the stroke still commits its own dab',await page.evaluate(()=>styk.editor.undoLabel==='Brush stroke'));
  const fill=await page.evaluate(async()=>{
    const d=styk.drawing,start=performance.now();
    const result=await d.owner.worker.request('fill',{bounds:{x:-2048,y:-2048,width:4096,height:4096},tiles:[],options:{x:-2048,y:-2048,color:[20,40,60,255],tolerance:16,expansion:1,gap:0},maxBytes:64*1024*1024});
    return {ms:performance.now()-start,tiles:result.tiles.length};
  });
  check('a 4096x4096 tile fill completes under one second',fill.ms<1000&&fill.tiles>1000);
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'stroke.json'),JSON.stringify({checks,errors,stats,wallMs,fillMs:fill.ms,fillTiles:fill.tiles,browser:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,errors,checks},null,2));throw error;}
finally{await browser.close();}
