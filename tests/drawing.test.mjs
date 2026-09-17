import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {DrawingResources} from '../src/drawing-resources.mjs';
import {DrawingStroke,floodPixels,lassoMask,writeTile} from '../src/drawing-pixels.mjs';
import {drawingMetadata,validateDrawings,drawingMatrix,inversePoint,transformPoint,drawingExpansion,expandedDrawingFigure,drawingDimensions,EMPTY_PNG} from '../src/drawing-model.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {createFrame} from '../src/demo.mjs';

function fixture(){
  const e=new Editor({demo:false,layerTimeline:true});e.report.canvas_width=64;e.report.canvas_height=64;
  const worker={async request(kind,{width,height,tiles=[]}){const pixels=new Uint8ClampedArray(width*height*4);for(const t of tiles)writeTile(pixels,width,t,t.pixels);return kind==='decode'?{pixels:pixels.buffer}:{dataUrl:EMPTY_PNG};},dispose(){}};
  const resources=new DrawingResources(e.report,{worker});e.createDrawingLayer();return {e,resources};
}
async function stroke(e,x=40){const target=e.prepareDrawingCel(),surface=await e.drawingResources.surface(target.figure),brush=new DrawingStroke(surface.pixels,surface.width,surface.height,{size:8,pressureSize:false});brush.sample({x,y:40});const tiles=brush.finish();e.commitDrawingPixels(target,tiles);return {target,surface,tiles};}

test('Add Frame makes a blank only on the active drawing at a key, inside a hold and after its end',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);e.extendDrawing(undefined,7);const id=e.activeLayerId;
    const unrelated=structuredClone(Object.fromEntries(Object.entries(e.report._styk.layerSheet.tracks).filter(([key])=>key!==id)));
    e.addDrawingFrame();assert.equal(e.tick,8);assert.equal(e.drawingTarget().figure,undefined);e.undo();e.seek(3);
    e.addDrawingFrame();assert.equal(e.tick,3);assert.equal(e.drawingTarget().figure,undefined);assert.equal(e.drawingTarget().end,8);e.undo();
    e.seek(12,{allowBeyondEnd:true});e.addDrawingFrame();assert.equal(e.drawingTarget().figure,undefined);assert.equal(e.drawingTarget().key.tick,12);
    for(const [key,value] of Object.entries(unrelated))assert.deepEqual(e.report._styk.layerSheet.tracks[key],value);
  }finally{resources.dispose();}
});

test('paint growth preserves pixel world positions with rotated, mirrored and reversed poses',async()=>{
  const {e,resources}=fixture();try{
    const {target}=await stroke(e),bounds=drawingExpansion(target.figure,[{x:-50,y:-30},{x:190,y:180}],{margin:10}),copy=expandedDrawingFigure(target.figure,bounds,20);
    assert.ok(bounds.width>128&&bounds.height>128);assert.equal(drawingExpansion(copy,[{x:40,y:40}],{margin:2}),null);
    for(const mirror of [0,1])for(const reverse of [0,1]){
      const old=structuredClone(target.figure),next=structuredClone(copy),object={...target.object,angle_rad:.8,scale:1.5};
      for(const f of [old,next])Object.assign(f.segments[0],{extra_u8_a:reverse,extra_u8_b:mirror});
      const matrix=f=>drawingMatrix(buildGeometry({...e.report,figure_types:[f]},createFrame([{...object,figure_type_id:f.figure_type_id}])).drawables[0]);
      const a=transformPoint(matrix(old),{x:50,y:60}),b=transformPoint(matrix(next),{x:50+bounds.offsetX,y:60+bounds.offsetY});
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);
    }
    assert.throws(()=>drawingExpansion(target.figure,[{x:1e6,y:0}]),/memory limit/);
    assert.throws(()=>drawingExpansion(target.figure,[{x:200,y:200}],{maxPixels:1000}),/memory limit/);
  }finally{resources.dispose();}
});

test('4x cels validate and pointer-centered blank creation is independent of stage dimensions',()=>{
  const {e,resources}=fixture();try{
    assert.equal(drawingDimensions(64,64,4).width,512);
    e.report.canvas_width=8000;e.report.canvas_height=8000;
    const target=e.prepareDrawingCel({pixelsPerUnit:4,paintArea:{x:3000,y:-100,width:256,height:256}});
    assert.equal(target.figure._styk.drawing.pixelsPerUnit,4);assert.equal(target.figure._styk.drawing.origin.x,2968);
    validateDrawings({...e.report,figure_types:[...e.report.figure_types,target.figure]});
  }finally{resources.dispose();}
});

test('high-resolution brush tips retain their logical size instead of capping at 2048 pixels',()=>{
  const pixels=new Uint8ClampedArray(2200*2*4),brush=new DrawingStroke(pixels,2200,2,{size:4096,pressureSize:false});
  brush.dab({x:1100,y:1});assert.equal(pixels[2190*4+3],255);
});
test('a hold edits its owning drawing, copy splits independently and mixed undo restores exact bytes',async()=>{
  const {e,resources}=fixture();try{
    const {target,surface}=await stroke(e),original=surface.pixels.slice();e.extendDrawing(undefined,9);e.seek(5);
    assert.equal(e.drawingTarget().key.tick,0);e.drawingKey();const copy=e.drawingTarget();
    assert.notEqual(drawingMetadata(copy.figure).celId,drawingMetadata(target.figure).celId);
    assert.equal(copy.object.unique_id,target.object.unique_id);assert.equal(copy.end,10);
    await stroke(e,70);assert.deepEqual(surface.pixels,original);e.undo();e.undo();assert.equal(e.drawingTarget().key.tick,0);
    e.undo();e.undo();assert.equal(e.drawingTarget().figure,undefined);assert.equal(e.report.figure_types[0].name,'Walker');e.redo();assert.deepEqual(resources.entry(target.figure).pixels,original);
  }finally{resources.dispose();}
});
test('blank replacement and next drawing preserve unrelated layers and boundaries',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);e.extendDrawing(undefined,7);e.seek(4);e.drawingKey();e.seek(2);e.drawingKey(undefined,2,{blank:true});
    assert.deepEqual(e.layerFrameKeys().map(k=>k.tick),[0,2,4]);assert.equal(e.drawingTarget().figure,undefined);
    const other=structuredClone(e.report._styk.layerSheet.tracks['layer-1']);e.nextDrawing(undefined,{blank:true,length:2});
    assert.deepEqual(e.layerFrameKeys().map(k=>k.tick),[0,2,4,6]);assert.deepEqual(e.report._styk.layerSheet.tracks['layer-1'],other);
    const before=e.revision;assert.equal(e.drawingKey(),false);assert.equal(e.revision,before);
  }finally{resources.dispose();}
});
test('drawing target and atomic lock checks reject before mutation',()=>{
  const {e,resources}=fixture();try{
    e.seek(20,{allowBeyondEnd:true});assert.throws(()=>e.prepareDrawingCel(),/Blank drawing/);
    const second=e.createDrawingLayer('Second');e.setLayerLocked(second.id,true);const before=e.serialize();
    assert.throws(()=>e.drawingKey(['layer-2',second.id],0,{blank:true}),/unlock/i);assert.deepEqual(e.serialize(),before);
    assert.throws(()=>e.sheetAssignFigures([],second.id),/drawing/i);
  }finally{resources.dispose();}
});
test('stroke opacity caps overlapping dabs; cancellation and transparent erasing preserve exact history',()=>{
  const pixels=new Uint8ClampedArray(64*64*4),b=new DrawingStroke(pixels,64,64,{size:20,opacity:.5,flow:1,pressureSize:false});
  for(let i=0;i<8;i++)b.dab({x:20,y:20});assert.equal(pixels[(20*64+20)*4+3],128);
  b.cancel();assert.ok(pixels.every(n=>n===0));
  pixels.fill(255);const eraser=new DrawingStroke(pixels,64,64,{size:20,opacity:.5,erase:true,pressureSize:false});for(let i=0;i<8;i++)eraser.dab({x:20,y:20});assert.equal(pixels[(20*64+20)*4+3],128);
  const tiles=eraser.finish();writeTile(pixels,64,tiles[0],tiles[0].before);assert.ok(pixels.every(n=>n===255));
});
test('tile budget rejects long strokes and rollback restores every touched tile',()=>{
  const pixels=new Uint8ClampedArray(128*64*4),stroke=new DrawingStroke(pixels,128,64,{size:8,maxBytes:33088});stroke.sample({x:10,y:20});
  assert.throws(()=>stroke.sample({x:100,y:20}),/budget/);stroke.cancel();assert.ok(pixels.every(n=>n===0));
});
test('undo and redo retain a shared history byte budget',async()=>{
  const {e,resources}=fixture();try{await stroke(e);const bytes=e.historySize;e.undo();assert.equal(e.historySize,bytes);e.redo();assert.equal(e.historySize,bytes);e.undo();const redo=e._redo.reduce((n,c)=>n+c.bytes,0);e.renameLayer(e.activeLayerId,'Ink');assert.equal(e.historySize,bytes-redo+e._undo.at(-1).bytes);}finally{resources.dispose();}
});
test('painting an existing cel does not publish structural timeline changes',async()=>{
  const {e,resources}=fixture();try{await stroke(e);const events=[];e.addEventListener('change',event=>events.push(event.detail));await stroke(e,80);
    assert.equal(e._undo.at(-1).kind,'drawing-pixels');assert.ok(events.some(event=>event.drawing));assert.ok(events.every(event=>!event.structural&&!event.timing));
    e.undo();e.redo();assert.ok(events.every(event=>!event.structural&&!event.timing));
  }finally{resources.dispose();}
});
test('fill treats transparent RGB consistently, stops at boundaries, and lasso masks pixels',()=>{
  const p=new Uint8ClampedArray(10*10*4);for(let y=0;y<10;y++)p.set([0,0,0,255],(y*10+5)*4);p.set([240,0,0,0],0);
  floodPixels(p,10,10,{x:0,y:0,color:[255,0,0,255],tolerance:0});assert.equal(p[3],255);assert.equal(p[(9*10+9)*4+3],0);
  const mask=lassoMask(10,10,[{x:1,y:1},{x:4,y:1},{x:4,y:4},{x:1,y:4}]);assert.equal(mask.reduce((a,b)=>a+b,0),9);
});
test('sprite mapping inverts scale, rotation, mirror, reverse and crop anchor',()=>{
  for(const mirror of [0,1])for(const reverse of [0,1]){
    const angle=.7,item={asset:{anchor_start:{x:32,y:20},anchor_length:40,anchor_angle_rad:.2},seg:{extra_u8_a:reverse,extra_u8_b:mirror},obj:{},angle,start:{x:80,y:90},end:{x:80+80*Math.cos(angle),y:90+80*Math.sin(angle)}};
    const matrix=drawingMatrix(item),point={x:15.2,y:71.8},result=inversePoint(matrix,transformPoint(matrix,point));assert.ok(Math.abs(result.x-point.x)<1e-9&&Math.abs(result.y-point.y)<1e-9);
  }
});
test('malformed and duplicate drawing metadata is rejected',async()=>{
  const {e,resources}=fixture();try{const {target}=await stroke(e);validateDrawings(e.report);const copy=structuredClone(target.figure);e.report.figure_types.push(copy);assert.throws(()=>validateDrawings(e.report),/unique/);e.report.figure_types.pop();drawingMetadata(e.report.figure_types.at(-1)).width=1e9;assert.throws(()=>validateDrawings(e.report),/dimensions/);}finally{resources.dispose();}
});


test('pressure release cannot remove paint laid earlier in the same stroke',()=>{
  const pixels=new Uint8ClampedArray(32*32*4),b=new DrawingStroke(pixels,32,32,{size:16,pressureSize:false,pressureOpacity:true,flow:1});
  b.dab({x:16,y:16,pressure:1});const before=pixels.slice();b.dab({x:16,y:16,pressure:.1});assert.deepEqual(pixels,before);
});
test('clipboard captures pending pixels once and remains independent of later source edits',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);e.sheetCopyFrames([e.activeLayerId],0,0);const source=e.drawingTarget(),original=resources.entry(source.figure).pixels.slice();
    await stroke(e,80);const layer=e.createDrawingLayer('Pasted');e.sheetPasteFrames([layer.id],0);const pasted=await resources.surface(e.drawingTarget().figure);
    assert.deepEqual(pasted.pixels,original);assert.notEqual(e.drawingTarget().figure._styk.drawing.celId,source.figure._styk.drawing.celId);
    await stroke(e,100);assert.notDeepEqual(resources.entry(source.figure).pixels,pasted.pixels);
  }finally{resources.dispose();}
});
test('history restores tile snapshots synchronously after decoded surface eviction',async()=>{
  const {e,resources}=fixture();try{const {surface}=await stroke(e),first=surface.pixels.slice();await stroke(e,80);surface.pixels=null;e.undo();const restored=await resources.surface(e.drawingTarget().figure);assert.deepEqual(restored.pixels,first);e.redo();assert.notDeepEqual(restored.pixels,first);}finally{resources.dispose();}
});
test('drawing onion samples skip the current held cel and retain frame-mode sampling',async()=>{
  const {drawingOnionSamples}=await import('../src/onion-skin.mjs');const {e,resources}=fixture();try{await stroke(e);e.extendDrawing(undefined,9);e.seek(5);e.drawingKey();e.seek(7);
    const settings={onionMode:'keys',onionBefore:2,onionAfter:2,onionStep:1};assert.deepEqual(drawingOnionSamples(e,settings).map(s=>s.tick),[0]);assert.deepEqual(drawingOnionSamples(e,{...settings,onionMode:'frames'}),[]);
  }finally{resources.dispose();}
});
test('a replacement document disposes drawing workers and their pending state',async()=>{
  const {e,resources}=fixture();await stroke(e);e.load(new Editor({demo:false}).report);assert.equal(resources.disposed,true);assert.equal(resources.entries.size,0);
});


test('failed encoders retain dirty pixels and a retry publishes the same committed revision',async()=>{
  const {e,resources}=fixture();try{await stroke(e);const figure=e.drawingTarget().figure,entry=resources.entry(figure),revision=e.revision,pixels=entry.pixels.slice();let calls=0;
    resources.worker={async request(){if(!calls++)throw new Error('encoder failure');return {dataUrl:EMPTY_PNG};},dispose(){}};
    await assert.rejects(resources.flush(),/encoder failure/);assert.ok(entry.tiles.size);assert.deepEqual(entry.pixels,pixels);assert.equal(e.revision,revision);
    await resources.flush();assert.equal(entry.tiles.size,0);assert.equal(e.revision,revision);
  }finally{resources.dispose();}
});
test('out-of-order encode results never replace newer committed tiles',async()=>{
  const {e,resources}=fixture();try{await stroke(e);let release,calls=0;resources.worker={request(){calls++;if(calls===1)return new Promise(resolve=>release=resolve);return Promise.resolve({dataUrl:EMPTY_PNG});},dispose(){}};
    const pending=resources.flush();await stroke(e,80);const entry=resources.entry(e.drawingTarget().figure),latest=entry.pixels.slice();release({dataUrl:'stale PNG'});await pending;
    assert.equal(calls,2);assert.equal(entry.base,EMPTY_PNG);assert.deepEqual(entry.pixels,latest);assert.equal(entry.tiles.size,0);
  }finally{resources.dispose();}
});


test('uniform full-surface fill history is compact and restores exact RGBA',async()=>{
  const {pixelChanges,pixelChangeBytes}=await import('../src/drawing-pixels.mjs');const width=1984,height=1144,before=new Uint8ClampedArray(width*height*4),after=new Uint8ClampedArray(before.length);for(let p=0;p<after.length;p+=4)after.set([90,30,70,127],p);
  const tiles=pixelChanges(before,after,width,height,1024*1024);assert.ok(pixelChangeBytes(tiles)<100000);
  const restored=before.slice();for(const tile of tiles)writeTile(restored,width,tile,tile.after);assert.deepEqual(restored,after);for(const tile of tiles)writeTile(restored,width,tile,tile.before);assert.deepEqual(restored,before);
});
test('whole-scene paste matches drawing tracks by kind and pads extra drawing layers',async()=>{
  const {pasteSheetClipboard}=await import('../src/shared-clipboard.mjs');const {e,resources}=fixture(),other=new Editor({demo:false,layerTimeline:true});
  try{
    e.sheetCopyFrames(['scene','camera',e.activeLayerId,'layer-1'],0,0);
    const existing=other.createDrawingLayer('Existing ink'),surplus=other.createDrawingLayer('Spare ink');
    other._sheetClipboard={...structuredClone(e._sheetClipboard),document:null};
    const before=other.serialize();pasteSheetClipboard(other,[],0,{wholeScene:true,insert:true});
    assert.ok(other.getLayer(existing.id).drawing);assert.ok(other.getLayer(surplus.id).drawing);assert.equal(other.layers.filter(l=>l.drawing).length,2);
    other.undo();assert.deepEqual(other.serialize(),before);
  }finally{resources.dispose();other.drawingResources.dispose();}
});
