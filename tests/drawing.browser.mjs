import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve(process.env.STYK_DRAWING_ARTIFACTS||'artifacts/drawing'),url=process.env.STYK_URL||'http://127.0.0.1:47839';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
try{
  await page.goto(url);await page.waitForFunction(()=>window.styk?.ready);
  const baseline=await page.evaluate(()=>{styk.state.settings.autosaveSeconds=0;return styk.editor.revision;});await page.locator('[data-workspace-mode="draw"]').click();
  check('entering Draw does not mutate the document',await page.evaluate(()=>styk.editor.revision)===baseline);
  check('new drawings default to 2x resolution',await page.evaluate(()=>styk.drawing.settings.resolution===2));
  // Keep this existing codec/history workload at its original 1x resolution.
  await page.evaluate(()=>styk.drawing.settings.resolution=1);
  await page.locator('[data-draw-action="new"]').first().click();
  const rect=await page.locator('#viewport').boundingBox();
  const start={x:rect.x+rect.width*.3,y:rect.y+rect.height*.45},end={x:start.x+130,y:start.y+60};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(end.x,end.y,{steps:16});await page.mouse.up();
  await page.waitForFunction(()=>Boolean(styk.editor.drawingTarget().figure));
  check('pointer stroke creates one cel and one undo command',await page.evaluate(()=>styk.editor.undoLabel==='Brush stroke'&&styk.editor.drawingTarget().figure._styk.drawing.version===1));
  check('stroke stores nontransparent pixels',await page.evaluate(()=>{window.initialPixels=styk.drawing.owner.entry(styk.editor.drawingTarget().figure).pixels.slice();return initialPixels.some((n,i)=>i%4===3&&n);}));
  await page.screenshot({path:path.join(output,'draw-workspace.png')});
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:path.join(output,'draw-workspace-compact.png')});check('compact workspace keeps the brush rail and property controls accessible',await page.locator('.tool-dock [data-tool="drawing-brush"]').isVisible()&&await page.locator('#inspector [data-property="draw:size"]').count()===1);await page.setViewportSize({width:1440,height:1000});
  await page.keyboard.press('Control+z');check('first stroke and cel creation undo together',await page.evaluate(()=>!styk.editor.drawingTarget().figure));
  await page.keyboard.press('Control+Shift+z');
  check('redo restores exact RGBA',await page.evaluate(()=>styk.drawing.owner.entry(styk.editor.drawingTarget().figure).pixels.every((n,i)=>n===initialPixels[i])));
  await page.evaluate(()=>styk.editor.extendDrawing(undefined,7));await page.evaluate(()=>styk.editor.seek(4));
  await page.evaluate(()=>window.styk.drawing.action('copy-key'));
  check('Copy here splits the hold into an independent drawing',await page.evaluate(()=>{const e=styk.editor,id=e.drawingTarget().figure._styk.drawing.celId;e.seek(0);const old=e.drawingTarget().figure._styk.drawing.celId;e.seek(4);return id!==old;}));
  await page.evaluate(()=>styk.drawing.prepareVisible());
  await page.locator('[data-tool="drawing-eraser"]').click();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(end.x,end.y,{steps:16});await page.mouse.up();
  const counts=await page.evaluate(async()=>{const e=styk.editor,copied=styk.drawing.owner.entry(e.drawingTarget().figure).pixels.filter((n,i)=>i%4===3&&n).length;e.seek(0);await styk.drawing.prepareVisible();const original=styk.drawing.owner.entry(e.drawingTarget().figure).pixels.filter((n,i)=>i%4===3&&n).length;return {original,copied};});
  check('erasing the copy preserves original pixels',counts.original>counts.copied);
  await page.evaluate(()=>styk.drawing.barrier());
  check('publication drains all dirty work',await page.evaluate(()=>styk.drawing.owner.stats.queued===0));
  const exact=await page.evaluate(async()=>{const {decodeDrawingPNG}=await import('/src/drawing-png.mjs'),e=styk.editor,d=styk.drawing,figure=e.drawingTarget().figure,entry=d.owner.entry(figure),before=entry.pixels.slice(),decoded=await decodeDrawingPNG(figure.image_assets[0].data_url);return decoded.pixels.every((n,i)=>n===before[i]);});
  check('published PNG matches committed RGBA',exact);
  const native=await page.evaluate(async()=>{
    const {DocumentExporter}=await import('/src/document-export.mjs'),{ImportClient}=await import('/src/import-client.mjs'),{Editor}=await import('/src/editor.mjs'),{decodeDrawingPNG}=await import('/src/drawing-png.mjs');
    const exporter=new DocumentExporter(),importer=new ImportClient(),e=styk.editor;
    const blob=await exporter.export(e.report,{format:'styk',getRevision:()=>e.revision});
    const reopened=await importer.importFile(new File([blob],'drawings.styk'));
    const restored=new Editor({demo:false});restored.load(reopened.document);
    const figures=restored.report.figure_types.filter(f=>f._styk?.drawing),pixels=await decodeDrawingPNG(figures[0].image_assets[0].data_url);
    return {bytes:blob.size,cels:figures.length,exact:pixels.pixels.every((n,i)=>n===initialPixels[i]),layers:restored.layers.filter(l=>l.drawing).length};
  });
  check('native save and real codec reopen preserve editable layers and exact pixels',native.cels===2&&native.layers===1&&native.exact);
  const reused=await page.evaluate(async()=>{
    const {clipboardSnapshot,restoreClipboard,pasteSheetClipboard}=await import('/src/shared-clipboard.mjs'),{Editor}=await import('/src/editor.mjs');
    const e=styk.editor,d=styk.drawing,source=e.drawingTarget(),pixels=d.owner.entry(source.figure).pixels.slice();
    e.sheetCopyFrames([source.id],0,3);const packet=structuredClone(clipboardSnapshot(e,'sheet'));
    const other=new Editor({demo:false,layerTimeline:true}),layer=other.createDrawingLayer();await restoreClipboard(other,packet);pasteSheetClipboard(other,[layer.id],0);
    const copied=other.drawingTarget(),surface=await other.drawingResources.surface(copied.figure);const foreign=copied.figure._styk.drawing.celId!==source.figure._styk.drawing.celId&&surface.pixels.every((n,i)=>n===pixels[i]);other.drawingResources.dispose();
    await d.action('duplicate-layer');const duplicate=e.drawingTarget(),duplicateSurface=await d.owner.surface(duplicate.figure),independent=duplicate.figure._styk.drawing.celId!==source.figure._styk.drawing.celId&&duplicateSurface.pixels.every((n,i)=>n===pixels[i]);e.undo();e.selectSheetLayer(source.id);await d.prepareVisible();return {foreign,independent};
  });
  check('cross-project timeline paste preserves independent exact pixels',reused.foreign);
  check('Duplicate drawing layer preserves independent exact pixels',reused.independent);

  check('drawing tools are in the studio rail and use the native property inspector',await page.locator('.tool-dock [data-tool="drawing-eraser"]').isVisible()&&await page.locator('#inspector [data-property="draw:size"]').isVisible()&&await page.locator('.drawing-panel').count()===0);
  check('drawing layer has a distinct icon and selected row',await page.locator('.sheet-layer[data-drawing="true"][data-selected="true"]').count()===1);
  await page.locator('[data-tool="drawing-brush"]').click();await page.locator('[data-draw-preset="soft"]').click();
  check('soft preset updates the shared brush controls',await page.evaluate(()=>styk.drawing.settings.hardness===0&&styk.drawing.settings.flow===.25));
  await page.locator('[data-draw-preset="ink"]').click();
  const more=await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing,owner=d.owner;await d.prepareVisible();let target=e.drawingTarget(),surface=owner.entry(target.figure),before=surface.pixels.slice();
    d.makeSelection({target,surface,points:[{x:0,y:0},{x:surface.width,y:0},{x:surface.width,y:surface.height},{x:0,y:surface.height}]});
    d.selection.dx=14;d.previewSelection();const hitTest=d.selectionContains({x:30,y:30})&&!d.selectionContains({x:0,y:30});const preview=surface.context.getImageData(0,0,surface.width,surface.height).data.slice();d.selection.dx=28;d.previewSelection();d.selection.dx=14;d.previewSelection();
    const repeat=surface.context.getImageData(0,0,surface.width,surface.height).data.every((n,i)=>n===preview[i]);
    d.applySelection();e.undo();const exact=surface.pixels.every((n,i)=>n===before[i]);
    d.makeSelection({target:e.drawingTarget(),surface,points:[{x:0,y:0},{x:surface.width,y:0},{x:surface.width,y:surface.height},{x:0,y:surface.height}]});
    await d.action('copy-pixels');d.cancelSelection();await d.action('paste-pixels');e.undo();
    const clipboard=styk.clipboard.kind==='drawing-pixels'&&surface.pixels.every((n,i)=>n===before[i]);
    d.settings.color='#d62030';await d.fill(e.drawingTarget(),surface,{x:1,y:1});const filled=surface.pixels[3]===255;e.undo();const fillUndo=surface.pixels.every((n,i)=>n===before[i]);
    d.settings.resolution=2;const object=e.drawingTarget().object,scale=object.scale;await d.action('resample');const resampled=e.drawingTarget().figure._styk.drawing;
    const resample=resampled.width===surface.width*2&&e.drawingTarget().object.scale===scale/2;e.undo();const resampleUndo=e.drawingTarget().figure._styk.drawing.width===surface.width;
    d.settings.resolution=1;await d.barrier();const revision=e.revision,pending=d.fill(e.drawingTarget(),surface,{x:1,y:1});d.cancel();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}const fillCancel=cancelled&&e.revision===revision&&surface.pixels.every((n,i)=>n===before[i]);return {repeat,hitTest,exact,clipboard,filled,fillUndo,fillCancel,resample,resampleUndo};
  });
  for(const [name,value] of Object.entries(more))check('pixel editing: '+name,value);
  const exports=await page.evaluate(async()=>{
    const {DocumentExporter}=await import('/src/document-export.mjs'),{ImportClient}=await import('/src/import-client.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
    const e=styk.editor,exporter=new DocumentExporter(),importer=new ImportClient();e.select(e.drawingTarget().object.unique_id);
    const result={};for(const format of ['piv','stk']){const blob=await exporter.export(e.report,{format,figureTypeId:e.figure.figure_type_id,figureUid:e.selectedUid,tick:e.tick});const read=await importer.importFile(new File([blob],'drawing.'+format));result[format]={bytes:blob.size,sprites:read.document.figure_types.filter(f=>f.image_assets?.length).length};}
    const renderer=new ExportFrameRenderer({width:e.report.canvas_width,height:e.report.canvas_height,smoothing:'edges',getRevision:()=>e.revision});
    try{await renderer.load(e.report);const svg=await renderer.renderSVGTick(0);result.svg=(await svg.text()).includes('data:image/png');const rendered=await renderer.renderTick(0);result.raster=renderer.canvas.width===e.report.canvas_width&&renderer.context.getImageData(0,0,renderer.width,renderer.height).data.some((n,i)=>i%4===3&&n);const {exportAnimation}=await import('/src/image-export.mjs'),{encodeWebM}=await import('/src/video-export.mjs');result.encoded={};for(const format of ['gif','apng','png-sequence']){const blob=await exportAnimation({format,width:renderer.width,height:renderer.height,fps:24,totalFrames:2,renderFrame:index=>renderer.renderTick(index*4)});result.encoded[format]=blob.size;}const video=await encodeWebM({width:renderer.width,height:renderer.height,fps:24,totalFrames:2,renderFrame:index=>renderer.renderTick(index*4)});result.encoded.webm=video.size;}finally{renderer.dispose();}return result;
  });
  check('GIF, APNG, image sequence and WebM encoders produce drawing animation',Object.values(exports.encoded).every(n=>n>100));
  check('PIV and STK native codecs reopen drawing sprites',exports.piv.sprites>0&&exports.stk.sprites>0);
  check('SVG embeds raster drawing pixels',exports.svg);check('image/video frame pipeline renders drawing artwork',exports.raster);


  const presentation=await page.evaluate(async()=>{
    const {createRenderer}=await import('/src/renderer.mjs'),{buildGeometry}=await import('/src/pivot/geometry.mjs');
    const e=styk.editor,d=styk.drawing;await d.prepareVisible();const target=e.drawingTarget(),figure=target.figure,entry=d.owner.entry(figure);
    const c=document.createElement('canvas'),renderer=await createRenderer(c,{forceCanvas2D:true,resources:{drawing:f=>d.resource(f),url:a=>a?.data_url}});renderer.resize(960,540,1);
    try{renderer.render({report:e.report,frame:e.evaluatedFrame,geometry:buildGeometry(e.report,e.evaluatedFrame),view:{x:0,y:0,scale:1,rotation:.25},cameraEnabled:false,clipToCanvas:true,vfxEnabled:false});const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {backend:renderer.stats.backend,painted:rgba.some((n,i)=>i%4===3&&n),transparentCorner:rgba[3]===0};}finally{renderer.destroy();}
  });
  check('Canvas fallback renders rotated artwork with rotated stage clipping',presentation.painted&&presentation.transparentCorner);
  await page.locator('[data-tool="drawing-brush"]').click();
  const revisionBeforeCancel=await page.evaluate(()=>styk.editor.revision);await page.mouse.move(start.x+30,start.y+20);await page.mouse.down();await page.waitForFunction(()=>Boolean(styk.drawing.gesture));await page.mouse.move(end.x,end.y+40,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
  check('Escape rolls back a captured stroke without a history entry',await page.evaluate(()=>styk.editor.revision)===revisionBeforeCancel);
  await page.keyboard.press('Shift+a');check('existing Shift+A extends the active drawing exposure',await page.evaluate(()=>styk.editor.undoLabel==='Extend drawing exposure'));
  const lifecycle=await page.evaluate(async()=>{
    const e=styk.editor,d=styk.drawing;await d.barrier();
    const clip=e.createEmptyMovieclip('Drawing lifecycle');e.enterMovieclip(clip.figure_type_id);e.createDrawingLayer();d.bind();
    const target=e.prepareDrawingCel(),surface=await d.owner.surface(target.figure),{DrawingStroke}=await import('/src/drawing-pixels.mjs');
    const stroke=new DrawingStroke(surface.pixels,surface.width,surface.height,{size:10});stroke.sample({x:45,y:45});e.commitDrawingPixels(target,stroke.finish());
    let guarded=false;try{e.leaveMovieclip();}catch{guarded=true;}await d.barrier();const owner=d.owner;e.leaveMovieclip();
    const saved=e.report.figure_types.find(f=>f.figure_type_id===clip.figure_type_id)._styk.movieclip.document.figure_types.find(f=>f._styk?.drawing);
    const disposed=owner.disposed;return {guarded,disposed,saved:Boolean(saved?.image_assets[0].data_url.length>100)};
  });
  check('nested drawing publication survives returning to the scene',lifecycle.guarded&&lifecycle.disposed&&lifecycle.saved);
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'browser.json'),JSON.stringify({checks,errors,backend:await page.evaluate(()=>styk.state.renderer.stats),runtime:await browser.version()},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'browser-failure.json'),JSON.stringify({message:error.message,errors,checks},null,2));throw error;}
finally{await browser.close();}
