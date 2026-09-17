import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('artifacts/drawing-ux'),checks=[],errors=[];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const stroke=async(x,y,dx=90,dy=35)=>{await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();await page.waitForFunction(()=>!styk.drawing.gesture);};
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47839');await page.waitForFunction(()=>styk.ready);
  // pix: snapshot a tile store's occupied bounds + RGBA; pixEq: exact compare.
  await page.evaluate(()=>{window.pix=store=>{const b=store.bounds;return {bounds:b?{...b}:null,pixels:b?store.readRect(b.x,b.y,b.width,b.height):new Uint8ClampedArray(0)};};window.pixEq=(a,b)=>Boolean(a.bounds&&b.bounds&&a.bounds.x===b.bounds.x&&a.bounds.y===b.bounds.y&&a.bounds.width===b.bounds.width&&a.bounds.height===b.bounds.height&&a.pixels.length===b.pixels.length&&a.pixels.every((n,i)=>n===b.pixels[i]));window.visEq=(a,b)=>a.pixels.length===b.pixels.length&&a.pixels.every((n,i)=>i%4===3?n===b.pixels[i]:(a.pixels[i-i%4+3]===0&&b.pixels[i-i%4+3]===0)||n===b.pixels[i]);});
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
  await page.evaluate(async()=>{await styk.drawing.barrier();const e=styk.editor,d=styk.drawing,t=e.drawingTarget(),{drawingPixelMatrix}=await import('/src/drawing-model.mjs'),s=await d.owner.surface(t.figure);window.oldDrawing={id:t.figure._styk.drawing.celId,figure:t.figure,object:structuredClone(t.object),snap:pix(s.store),matrix:drawingPixelMatrix(d.geometryItem(t)),revision:e.revision};});
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x-600,y,{steps:12});await page.mouse.up({button:'middle'});
  const strokeStart=performance.now();await stroke(x+80,y+80);const strokeMs=performance.now()-strokeStart;
  const growth=await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing,{drawingPixelMatrix,transformPoint,inversePoint}=await import('/src/drawing-model.mjs'),t=e.drawingTarget(),s=d.owner.entry(t.figure),matrix=drawingPixelMatrix(d.geometryItem(t));
    const p={x:100,y:80},world=transformPoint(oldDrawing.matrix,p),q=inversePoint(matrix,world),offset={x:Math.round(q.x-p.x),y:Math.round(q.y-p.y)},old=oldDrawing.snap,now=s.store.bounds;
    let exact=true;for(let y=0;y<old.bounds.height&&exact;y++)for(let x=0;x<old.bounds.width;x++){const i=(y*old.bounds.width+x)*4;if(!old.pixels[i+3])continue;const px=s.store.pixel(old.bounds.x+x+offset.x,old.bounds.y+y+offset.y);for(let c=0;c<4;c++)if(px[c]!==old.pixels[i+c])exact=false;}
    window.grownDrawing={id:t.figure._styk.drawing.celId,snap:pix(s.store)};
    const expanded=now.x<old.bounds.x||now.y<old.bounds.y||now.x+now.width>old.bounds.x+old.bounds.width||now.y+now.height>old.bounds.y+old.bounds.height;
    return {expanded,exact,unique:e.evaluatedFrame.objects.filter(o=>o.unique_id===t.object.unique_id).length===1,bytes:d.owner.stats.bytes};
  });
  check('painting beyond the stage edge adds tiles without moving or changing old ink',growth.expanded&&growth.exact&&growth.unique);
  await page.keyboard.press('Control+z');check('stroke undo restores the same cel',await page.evaluate(()=>styk.editor.drawingTarget().figure._styk.drawing.celId===oldDrawing.id));
  await page.keyboard.press('Control+Shift+z');await page.evaluate(()=>styk.drawing.prepareVisible());check('redo restores the painted tiles exactly',await page.evaluate(()=>{const t=styk.editor.drawingTarget(),s=styk.drawing.owner.entry(t.figure);return t.figure._styk.drawing.celId===grownDrawing.id&&pixEq(pix(s.store),grownDrawing.snap);}));
  await page.evaluate(()=>styk.drawing.barrier());
  check('tile cel publishes exact tile pixels',await page.evaluate(async()=>{const {decodeTileBlob}=await import('/src/drawing-tile-codec.mjs'),{TileStore}=await import('/src/drawing-tiles.mjs'),f=styk.editor.drawingTarget().figure,snap=grownDrawing.snap;
    const tiles=await decodeTileBlob(f.image_assets[0].styk_tiles),store=new TileStore();
    for(const t of tiles)store.set(t.tx,t.ty,t.pixels);
    return pixEq(pix(store),snap);}));
  check('pixel paste into a blank cel preserves artwork and its world origin',await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing,target=e.drawingTarget(),surface=await d.owner.surface(target.figure),B=surface.store.bounds;
    d.makeSelection({target,surface,points:[{x:B.x,y:B.y},{x:B.x+B.width,y:B.y},{x:B.x+B.width,y:B.y+B.height},{x:B.x,y:B.y+B.height}]});await d.action('copy-pixels');d.cancelSelection();e.addDrawingFrame();await d.action('paste-pixels');
    const pasted=e.drawingTarget(),entry=await d.owner.surface(pasted.figure),snap=pix(entry.store),clip=e._drawingPixelClipboard;
    const world=pasted.object&&clip?.world&&Math.hypot(pasted.object.root_x-clip.world.x,pasted.object.root_y-clip.world.y)<1e-6;
    const exact=world&&snap.bounds.width===grownDrawing.snap.bounds.width&&snap.bounds.height===grownDrawing.snap.bounds.height&&visEq(snap,grownDrawing.snap)&&pasted.figure._styk.drawing.celId!==target.figure._styk.drawing.celId;
    e.undo();e.undo();e.seek(0);await d.prepareVisible();return exact;
  }));
  const scaling=await page.evaluate(async()=>{
    const {drawingPixelMatrix,transformPoint}=await import('/src/drawing-model.mjs'),{drawGeometry}=await import('/src/pivot/geometry.mjs'),{exportSVG}=await import('/src/svg-export.mjs');
    const e=styk.editor,d=styk.drawing,t=e.drawingTarget(),item=d.geometryItem(t),p={x:400,y:320},before=transformPoint(drawingPixelMatrix(item),p);
    const calls=[],ctx=new Proxy({globalAlpha:1,canvas:{width:64,height:64}},{get:(o,k)=>k==='drawImage'?()=>calls.push({smoothing:o.imageSmoothingEnabled,quality:o.imageSmoothingQuality}):k==='getTransform'?()=>new DOMMatrix():k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
    drawGeometry(ctx,{drawables:[item]},{drawing:f=>d.resource(f),url:a=>a.data_url,image:()=>null});
    const image=new Image();image.src=t.figure.image_assets[0].data_url;await image.decode();
    const svg=await exportSVG({report:e.report,frame:e.evaluatedFrame,geometry:{drawables:[item]},resources:{url:a=>a.data_url,image:()=>image},smoothing:'edges'});
    d.settings.resolution=1;await d.action('resample');const after=transformPoint(drawingPixelMatrix(d.geometryItem(e.drawingTarget())),{x:p.x/2,y:p.y/2});e.undo();d.settings.resolution=2;await d.prepareVisible();
    return {smooth:calls.some(c=>c.smoothing&&c.quality==='high'),svg:(await svg.text()).includes('image-rendering="auto"'),pose:Math.hypot(before.x-after.x,before.y-after.y)<1e-6};
  });
  check('Canvas and SVG use smooth drawing scaling',scaling.smooth&&scaling.svg);
  check('resampling a cel preserves its world placement',scaling.pose);
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+500,y+180,{steps:10});await page.mouse.up({button:'middle'});
  await page.evaluate(()=>{window.cancelState={revision:styk.editor.revision,figures:styk.editor.report.figure_types.length,entries:styk.drawing.owner.entries.size};});
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(x+40,y+10);await page.keyboard.press('Escape');await page.mouse.up();await page.waitForFunction(()=>!styk.drawing.gesture);
  check('cancelled stroke publishes no cel, history or orphan store entry',await page.evaluate(()=>styk.editor.revision===cancelState.revision&&styk.editor.report.figure_types.length===cancelState.figures&&styk.drawing.owner.entries.size===cancelState.entries));
  await page.evaluate(()=>{const d=styk.drawing,e=styk.editor;d.owner.entry(e.drawingTarget().figure).store=null;window.releaseDecode=null;const request=d.owner.decodeWorker.request.bind(d.owner.decodeWorker);d.owner.decodeWorker.request=(kind,...args)=>{const result=request(kind,...args);return kind==='decode-tiles'?result.then(async r=>{await new Promise(resolve=>window.releaseDecode=resolve);return r;}):result;};});
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>Boolean(window.releaseDecode));
  await page.evaluate(()=>{styk.editor.renameLayer(styk.editor.activeLayerId,'Ink');releaseDecode();});await page.waitForFunction(()=>!styk.drawing.loading);await page.mouse.up();
  check('a document edit invalidates a pending cel decode and releases input',await page.evaluate(()=>!styk.drawing.gesture&&styk.editor.drawingTarget().figure._styk.drawing.celId===grownDrawing.id&&styk.editor.report.figure_types.length===cancelState.figures));
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
  await writeFile(path.join(output,'ux.json'),JSON.stringify({checks,errors,growth,strokeMs,browser:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error;}
finally{await browser.close();}
