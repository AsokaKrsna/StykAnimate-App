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
  // Stroke quality regressions, run against the same in-page stroke engine.
  const quality=await page.evaluate(async()=>{
    const {DrawingStroke}=await import('/src/drawing-pixels.mjs'),{TileStore}=await import('/src/drawing-tiles.mjs');
    const near=(store,x,y,r)=>{for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(store.pixel(Math.round(x)+dx,Math.round(y)+dy)[3]>100)return true;return false;};
    // Jittery input at stabilization 0 plus a 90° corner: no ink gaps.
    const jit=[{x:20,y:20}];let x=20,y=20;
    for(let i=1;i<=20;i++)jit.push({x:x+=4,y:y+(i%2?1.6:-1.6)});
    const cx=x,cy=y;for(let i=1;i<=20;i++)jit.push({x:cx,y:cy+i*4});
    const a=new DrawingStroke(new TileStore(),{size:8,pressureSize:false,stabilization:0,spacingRatio:.2});
    for(const p of jit)a.sample(p);a.finish();
    let gaps=0;for(let i=1;i<jit.length;i++){const p=jit[i-1],q=jit[i],n=Math.max(1,Math.ceil(Math.hypot(q.x-p.x,q.y-p.y)/2));for(let j=0;j<=n;j++)if(!near(a.store,p.x+(q.x-p.x)*j/n,p.y+(q.y-p.y)*j/n,8))gaps++;}
    // A slow small circle at stabilization .95 must follow the curve, not stall.
    const circ=[];for(let i=0;i<=120;i++){const t=i/120*Math.PI*2;circ.push({x:200+20*Math.cos(t),y:200+20*Math.sin(t),time:i*50});}
    const b=new DrawingStroke(new TileStore(),{size:10,pressureSize:false,stabilization:.95,spacingRatio:.1,pixelsPerUnit:1});
    for(const p of circ)b.sample(p);b.finish();
    let covered=0;for(const p of circ)if(near(b.store,p.x,p.y,24))covered++;
    let painted=0,bb=b.store.bounds;for(let py=bb.y;py<bb.y+bb.height;py++)for(let px=bb.x;px<bb.x+bb.width;px++)if(b.store.pixel(px,py)[3]>100)painted++;
    // The final dab lands exactly on the last sample at both stabilizations.
    const end=stab=>{const store=new TileStore(),s=new DrawingStroke(store,{size:6,pressureSize:false,stabilization:stab,pixelsPerUnit:1});s.sample({x:10,y:10});s.sample({x:30,y:16});s.sample({x:47.3,y:22.6});s.finish();return Math.max(store.pixel(47,22)[3],store.pixel(47,23)[3],store.pixel(48,22)[3],store.pixel(48,23)[3]);};
    return {gaps,covered:covered/circ.length,painted,end0:end(0),end95:end(.95)};
  });
  check('a jittery unstabilized stroke paints a continuous curve through its corner',quality.gaps===0);
  check('a heavily stabilized slow stroke follows its curve instead of stalling',quality.covered>.9&&quality.painted>120);
  check('stroke endpoints land exactly on the final sample',quality.end0>200&&quality.end95>200);
  const fill=await page.evaluate(async()=>{
    const d=styk.drawing,start=performance.now();
    const result=await d.owner.worker.request('fill',{bounds:{x:-2048,y:-2048,width:4096,height:4096},tiles:[],options:{x:-2048,y:-2048,color:[20,40,60,255],tolerance:16,expansion:1,gap:0},maxBytes:64*1024*1024});
    return {ms:performance.now()-start,tiles:result.tiles.length};
  });
  check('a 4096x4096 tile fill completes under one second',fill.ms<1000&&fill.tiles>1000);
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'stroke.json'),JSON.stringify({checks,errors,stats,wallMs,quality,fillMs:fill.ms,fillTiles:fill.tiles,browser:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,errors,checks},null,2));throw error;}
finally{await browser.close();}
