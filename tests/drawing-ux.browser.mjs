import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/drawing-ux'),checks=[],errors=[];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const stroke=async(x,y,dx=90,dy=35)=>{await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();};
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>styk.ready);
  await page.evaluate(()=>styk.state.settings.autosaveSeconds=0);await page.locator('[data-workspace-mode="draw"]').click();await page.locator('[data-draw-action="new"]').click();
  const rect=await page.locator('#viewport').boundingBox(),x=rect.x+rect.width*.4,y=rect.y+rect.height*.4;
  await page.evaluate(()=>window.beforePan={revision:styk.editor.revision,view:{...styk.state.view}});
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+96,y+48,{steps:6});await page.mouse.up({button:'middle'});
  check('middle-button pans with Brush and creates no ink or history',await page.evaluate(()=>styk.state.view.x-beforePan.view.x===96&&styk.state.view.y-beforePan.view.y===48&&styk.editor.revision===beforePan.revision&&!styk.drawing.gesture));
  await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(x+116,y+58);await page.keyboard.up('Space');await page.mouse.move(x+146,y+68);await page.mouse.up();
  check('Space pan continues after Space is released until pointer-up',await page.evaluate(()=>styk.editor.revision===beforePan.revision&&!styk.state.drag&&!styk.drawing.gesture&&styk.state.view.x-beforePan.view.x===146));
  await page.evaluate(()=>Object.assign(styk.state.view,beforePan.view));
  await stroke(x,y);
  check('normal brush drawing defaults to 2x pixels',await page.evaluate(()=>styk.editor.drawingTarget().figure._styk.drawing.pixelsPerUnit===2));
  check('Properties contains no exposure or frame creation controls',await page.locator('#inspector [data-draw-action="blank"],#inspector [data-draw-action="copy-key"],#inspector [data-draw-action^="next-"],#inspector [data-property="draw:length"]').count()===0);
  check('copied drawing action is available in the timeline',await page.getByRole('button',{name:'Next copied drawing',exact:true}).isVisible());
  await page.locator('[data-draw-preset="pencil"]').click();await page.locator('[data-tool="drawing-eraser"]').click();await page.evaluate(()=>styk.drawing.propertySet('draw:size',42));await page.locator('[data-tool="drawing-brush"]').click();
  check('Brush remembers its preset and size independently of Eraser',await page.evaluate(()=>styk.drawing.settings.size===2&&styk.drawing.settings.preset==='pencil'));
  await page.locator('[data-tool="drawing-eraser"]').click();check('Eraser remembers its own size',await page.evaluate(()=>styk.drawing.settings.size===42));await page.locator('[data-tool="drawing-brush"]').click();await page.locator('[data-draw-preset="ink"]').click();
  await page.evaluate(async()=>{await styk.drawing.barrier();const e=styk.editor,d=styk.drawing,t=e.drawingTarget();window.oldDrawing={id:t.figure._styk.drawing.celId,figure:t.figure,object:structuredClone(t.object),pixels:d.owner.entry(t.figure).pixels.slice(),matrix:(await import('/src/drawing-model.mjs')).drawingMatrix(d.geometryItem(t)),revision:e.revision};});
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x-600,y,{steps:12});await page.mouse.up({button:'middle'});
  const growthStart=performance.now();await stroke(x+80,y+80);const growthMs=performance.now()-growthStart;
  const growth=await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing,{drawingMatrix,transformPoint,inversePoint}=await import('/src/drawing-model.mjs'),t=e.drawingTarget(),s=d.owner.entry(t.figure),matrix=drawingMatrix(d.geometryItem(t));
    const p={x:100,y:80},world=transformPoint(oldDrawing.matrix,p),q=inversePoint(matrix,world),offset={x:Math.round(q.x-p.x),y:Math.round(q.y-p.y)};
    let exact=true;const old=oldDrawing.figure._styk.drawing;
    for(let y=0;y<old.height&&exact;y++)for(let x=0;x<old.width;x++){const i=(y*old.width+x)*4;if(!oldDrawing.pixels[i+3])continue;const j=((y+offset.y)*s.width+x+offset.x)*4;for(let c=0;c<4;c++)if(s.pixels[j+c]!==oldDrawing.pixels[i+c])exact=false;}
    window.grownDrawing={id:t.figure._styk.drawing.celId,pixels:s.pixels.slice(),width:s.width,height:s.height};
    return {expanded:s.width>old.width||s.height>old.height,exact,unique:e.evaluatedFrame.objects.filter(o=>o.unique_id===t.object.unique_id).length===1,bytes:d.owner.stats.decoded};
  });
  check('painting beyond the stage grows the cel without moving or changing old ink',growth.expanded&&growth.exact&&growth.unique);
  await page.keyboard.press('Control+z');check('growth and stroke undo together',await page.evaluate(()=>styk.editor.drawingTarget().figure._styk.drawing.celId===oldDrawing.id));
  await page.keyboard.press('Control+Shift+z');await page.evaluate(()=>styk.drawing.prepareVisible());check('redo restores the expanded pixels exactly',await page.evaluate(()=>{const t=styk.editor.drawingTarget(),s=styk.drawing.owner.entry(t.figure);return t.figure._styk.drawing.celId===grownDrawing.id&&s.pixels.every((v,i)=>v===grownDrawing.pixels[i]);}));
  await page.evaluate(()=>styk.drawing.barrier());
  check('expanded drawing publishes exact PNG pixels',await page.evaluate(async()=>{const {decodeDrawingPNG}=await import('/src/drawing-png.mjs'),f=styk.editor.drawingTarget().figure,p=await decodeDrawingPNG(f.image_assets[0].data_url);return p.width===grownDrawing.width&&p.height===grownDrawing.height&&p.pixels.every((v,i)=>v===grownDrawing.pixels[i]);}));
  check('pixel paste into a blank cel preserves expanded artwork and its origin',await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing,target=e.drawingTarget(),surface=d.owner.entry(target.figure),origin={...target.figure._styk.drawing.origin};
    d.makeSelection({target,surface,points:[{x:0,y:0},{x:surface.width,y:0},{x:surface.width,y:surface.height},{x:0,y:surface.height}]});await d.action('copy-pixels');d.cancelSelection();e.addDrawingFrame();await d.action('paste-pixels');
    const pasted=e.drawingTarget(),pixels=d.owner.entry(pasted.figure).pixels,exact=pixels.length===grownDrawing.pixels.length&&pixels.every((v,i)=>v===grownDrawing.pixels[i])&&pasted.figure._styk.drawing.origin.x===origin.x&&pasted.figure._styk.drawing.origin.y===origin.y;
    e.undo();e.undo();e.seek(0);await d.prepareVisible();return exact;
  }));
  const scaling=await page.evaluate(async()=>{
    const {drawingMatrix,transformPoint}=await import('/src/drawing-model.mjs'),{drawGeometry}=await import('/src/pivot/geometry.mjs'),{exportSVG}=await import('/src/svg-export.mjs');
    const e=styk.editor,d=styk.drawing,t=e.drawingTarget(),s=d.owner.entry(t.figure),item=d.geometryItem(t),p={x:400,y:320},before=transformPoint(drawingMatrix(item),p);
    const calls=[],ctx=new Proxy({globalAlpha:1},{get:(o,k)=>k==='drawImage'?()=>calls.push({smoothing:o.imageSmoothingEnabled,quality:o.imageSmoothingQuality}):k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
    drawGeometry(ctx,{drawables:[item]},{drawing:()=>s,url:a=>a.data_url,image:()=>s.canvas});
    const image=new Image();image.src=t.figure.image_assets[0].data_url;await image.decode();
    const svg=await exportSVG({report:e.report,frame:e.evaluatedFrame,geometry:{drawables:[item]},resources:{url:a=>a.data_url,image:()=>image},smoothing:'edges'});
    d.settings.resolution=1;await d.action('resample');const after=transformPoint(drawingMatrix(d.geometryItem(e.drawingTarget())),{x:p.x/2,y:p.y/2});e.undo();d.settings.resolution=2;await d.prepareVisible();
    return {smooth:calls.some(c=>c.smoothing&&c.quality==='high'),svg:(await svg.text()).includes('image-rendering="auto"'),pose:Math.hypot(before.x-after.x,before.y-after.y)<1e-6};
  });
  check('Canvas and SVG use smooth drawing scaling',scaling.smooth&&scaling.svg);
  check('resampling an expanded cel preserves its world placement',scaling.pose);
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+500,y+180,{steps:10});await page.mouse.up({button:'middle'});
  await page.evaluate(()=>{window.cancelState={revision:styk.editor.revision,figures:styk.editor.report.figure_types.length,entries:styk.drawing.owner.entries.size};});
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(x+40,y+10);await page.keyboard.press('Escape');await page.mouse.up();
  check('cancelled growth publishes no cel, history or orphan surface',await page.evaluate(()=>styk.editor.revision===cancelState.revision&&styk.editor.report.figure_types.length===cancelState.figures&&styk.drawing.owner.entries.size===cancelState.entries));
  await page.evaluate(()=>{const d=styk.drawing;window.releaseExpansion=null;const request=d.owner.worker.request.bind(d.owner.worker);d.owner.worker.request=async(kind,...args)=>{const result=await request(kind,...args);if(kind==='expand')await new Promise(resolve=>window.releaseExpansion=resolve);return result;};});
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(window.releaseExpansion));
  await page.evaluate(()=>{styk.editor.renameLayer(styk.editor.activeLayerId,'Ink');releaseExpansion();});await page.waitForFunction(()=>!styk.drawing.loading);await page.mouse.up();
  check('a document edit invalidates pending growth and releases input',await page.evaluate(()=>!styk.drawing.gesture&&styk.editor.drawingTarget().figure._styk.drawing.celId===grownDrawing.id&&styk.editor.report.figure_types.length===cancelState.figures));
  await page.evaluate(()=>styk.fit());await page.screenshot({path:path.join(output,'workspace.png')});
  for(const mode of ['advanced','simple']){
    await page.locator(`[data-timeline-mode="${mode}"]`).click();await page.evaluate(()=>{const e=styk.editor;e.seek(0);window.tracksBefore=structuredClone(e.report._styk.layerSheet.tracks);window.activeBefore=e.activeLayerId;});
    await page.locator('#viewport').focus();await page.keyboard.press('a');
    check(`A creates a blank key only on the active drawing layer in ${mode}`,await page.evaluate(()=>{const e=styk.editor;return !e.drawingTarget().figure&&e.activeLayerId===activeBefore&&Object.entries(tracksBefore).every(([id,track])=>id===activeBefore||JSON.stringify(e.report._styk.layerSheet.tracks[id])===JSON.stringify(track));}));
    await page.keyboard.press('Control+z');
  }
  await page.locator('[data-workspace-mode="animate"]').first().click();await page.locator('#viewport').focus();await page.keyboard.press('a');
  check('A uses drawing-layer semantics in Animate too',await page.evaluate(()=>!styk.editor.drawingTarget().figure));await page.keyboard.press('Control+z');await page.locator('[data-workspace-mode="draw"]').click();
  await page.locator('[data-timeline-mode="advanced"]').click();await page.setViewportSize({width:1024,height:768});await page.evaluate(()=>styk.fit());await page.screenshot({path:path.join(output,'workspace-compact.png')});
  check('compact inspector keeps size and opacity visible',await page.locator('[data-property="draw:size"]').isVisible()&&await page.locator('[data-property="draw:opacity"]').isVisible());
  check('changing timeline layout keeps figure handles hidden in Draw',await page.evaluate(()=>!styk.state.handles));
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'ux.json'),JSON.stringify({checks,errors,growth,growthMs,browser:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error;}
finally{await browser.close();}
