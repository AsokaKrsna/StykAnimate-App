import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {DrawingResources,defaultTileBudget} from '../src/drawing-resources.mjs';
import {DrawingStroke,StrokePath,normalizeBrush,dabExtent,gradientTiles,floodTiles,lassoMask,tileChanges,applyTileChanges,pixelChangeBytes} from '../src/drawing-pixels.mjs';
import {drawingMetadata,validateDrawings,drawingMatrix,drawingPixelMatrix,inversePoint,transformPoint,migrateDrawingFigure,EMPTY_PNG} from '../src/drawing-model.mjs';
import {TileStore,TILE,TILE_BYTES,tileKey,tileTransparent} from '../src/drawing-tiles.mjs';
import {encodeTileBlob,decodeTileBlob,tileStoreFromList,encodeTile,assembleTileBlobBytes,TILE_BLOB_PREFIX,TileEncodeCache} from '../src/drawing-tile-codec.mjs';
import {encodeDrawingPNG,decodeDrawingPNG} from '../src/drawing-png.mjs';
import {encodePNGPortable} from '../src/sticknodes/decoder/png-browser.mjs';
import {StrokeEngine} from '../src/drawing-stroke-engine.mjs';
import {presenterScratch,levelStore,invalidateLevels,flattenedDrawingPNG} from '../src/drawing-raster.mjs';
import {DrawingTileProvider} from '../src/drawing-provider.mjs';
import {createDrawingFigure} from '../src/drawing-model.mjs';
import {objectBounds} from '../src/renderer-geometry.mjs';
import {createImageFigure} from '../src/media-authoring.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {createFrame,createObject} from '../src/demo.mjs';

// In-process stand-in for drawing-worker.mjs; the browser tests exercise the
// real worker. OffscreenCanvas ops (paste/resample/thumbnail) are not stubbed.
function workerStub(){
  const storeOf=data=>{const store=new TileStore();for(const t of data.tiles??[])store.tiles.set(tileKey(t.tx,t.ty),{tx:t.tx,ty:t.ty,pixels:new Uint8ClampedArray(t.pixels),frozen:false,png:t.png?new Uint8Array(t.png):undefined});return store;};
  // Mirrors drawing-worker.mjs: the encoded-tile cache survives requests so a
  // re-publish only encodes tiles the caller resent.
  const encodeCache=new TileEncodeCache();
  return {async request(kind,data){
    if(kind==='decode-legacy'){
      const crop=data.crop??{x:0,y:0},image=await decodeDrawingPNG(data.url),tiles=[];
      for(const [tx,ty] of TileStore.tilesInRect(crop.x,crop.y,image.width,image.height)){
        const pixels=new Uint8ClampedArray(TILE_BYTES),ox=tx*TILE-crop.x,oy=ty*TILE-crop.y;
        for(let py=Math.max(0,-oy);py<Math.min(TILE,image.height-oy);py++)pixels.set(image.pixels.subarray(((py+oy)*image.width+Math.max(0,ox))*4,((py+oy)*image.width+Math.min(image.width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);
        const tile={tx,ty,pixels};if(!tileTransparent(tile))tiles.push({tx,ty,pixels:pixels.buffer});
      }
      return {tiles};
    }
    if(kind==='decode-tiles'){
      const decoded=await decodeTileBlob(data.url,{shard:data.shard}),levels=[];
      if(data.levels>0&&decoded.length){const entry={store:tileStoreFromList(decoded),levels:[]};for(let k=1;k<=data.levels;k++){const level=levelStore(entry,k);levels.push([...level].map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer})));if(!data.shard&&level.size<=4)break;}}
      return {tiles:decoded.map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.buffer,png:t.png.buffer})),levels};
    }
    if(kind==='encode-pngs')return {tiles:(data.tiles??[]).map(t=>({tx:t.tx,ty:t.ty,png:encodeTile(t.pixels).buffer}))};
    if(kind==='encode-tiles'){
      if(data.pngs?.length)encodeCache.adopt(data.celId,data.pngs);
      const result=await encodeCache.encode(data.celId,data.keep??[],data.tiles??[]);
      if(result.missing)return{missing:result.missing};
      const out=result.tiles.map(t=>({tx:t.tx,ty:t.ty,png:t.png.slice().buffer}));
      let text='';for(let i=0;i<result.bytes.length;i+=16384)text+=String.fromCharCode(...result.bytes.subarray(i,i+16384));
      return {tiles:out,blobUrl:TILE_BLOB_PREFIX+btoa(text),encoded:result.encoded,reused:result.reused};
    }
    if(kind==='fill'){
      const store=storeOf(data),before=new Map();
      for(const [tx,ty] of TileStore.tilesInRect(data.bounds.x,data.bounds.y,data.bounds.width,data.bounds.height))before.set(tileKey(tx,ty),store.get(tx,ty)?.pixels.slice()??null);
      floodTiles(store,{...data.options,bounds:data.bounds,source:data.source?new Uint8ClampedArray(data.source):undefined});
      return {tiles:tileChanges(store,before)};
    }
    throw new Error(`Unstubbed drawing worker op: ${kind}`);
  },dispose(){}};
}
function fixture(){
  const e=new Editor({demo:false,layerTimeline:true});e.report.canvas_width=64;e.report.canvas_height=64;
  const resources=new DrawingResources(e.report,{worker:workerStub()});e.createDrawingLayer();return {e,resources};
}
async function stroke(e,x=40,y=40){
  const target=e.prepareDrawingCel({pixelsPerUnit:1,world:{x:32,y:32}}),surface=await e.drawingResources.surface(target.figure);
  const brush=new DrawingStroke(surface.store,{size:8,pressureSize:false});brush.sample({x,y});
  const tiles=brush.finish();e.commitDrawingPixels(target,tiles);return {target,surface,tiles};
}
const snapshotStore=store=>new Map([...store].map(t=>[tileKey(t.tx,t.ty),t.pixels.slice()]));
const storePixels=store=>{const b=store.bounds;return b?store.readRect(b.x,b.y,b.width,b.height):new Uint8ClampedArray(0);};
async function legacyFigure({width=96,height=64,pixelsPerUnit=2,figureTypeId=1}={}){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((x*7+y*11)%13<3)pixels.set([x%256,y%256,(x+y)%256,255],(y*width+x)*4);
  const figure=createImageFigure({width,height,dataUrl:await encodeDrawingPNG(pixels,width,height),figureTypeId,name:'Drawing'});
  figure.image_assets[0].display_width=width;figure.image_assets[0].display_height=height;
  figure._styk.drawing={version:1,celId:'cel-legacy-1',width,height,pixelsPerUnit,origin:{x:0,y:0},crop:{x:0,y:0,width,height},revision:0,empty:false};
  return {figure,pixels};
}

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

test('TileStore forks share tiles, copy-on-write diverges and bounds track occupied pixels',()=>{
  const store=new TileStore();store.writeRect(-70,-70,140,140,new Uint8ClampedArray(140*140*4).fill(255));
  assert.deepEqual(store.bounds,{x:-70,y:-70,width:140,height:140});
  assert.deepEqual(store.pixel(-1,-1),[255,255,255,255]);
  assert.deepEqual(store.pixel(-70,-70),[255,255,255,255]);
  assert.deepEqual(store.pixel(70,70),[0,0,0,0]);
  const fork=store.fork();
  assert.ok([...store].every(t=>t.frozen));assert.ok([...fork].every(t=>t.frozen));
  assert.equal(fork.get(-2,-2),store.get(-2,-2));
  const writable=fork.writable(0,0);writable.pixels[3]=0;
  assert.notEqual(fork.get(0,0),store.get(0,0));assert.equal(store.get(0,0).pixels[3],255);
  store.writable(-2,-2).pixels[0]=7;assert.equal(fork.get(-2,-2).pixels[0],0);assert.equal(store.get(-2,-2).pixels[0],7);
  assert.equal(fork.pixel(70,70)[3],0);
});

test('TileStore set/delete/prune handle 4-byte uniform tiles and fully transparent tiles',()=>{
  const store=new TileStore();store.set(1,-1,new Uint8ClampedArray([9,8,7,6]));
  assert.equal(store.get(1,-1).pixels.length,TILE_BYTES);assert.deepEqual(store.pixel(64,-64),[9,8,7,6]);
  assert.equal(store.pixel(64,-64)[3],6);assert.deepEqual(store.bounds,{x:64,y:-64,width:64,height:64});
  store.writable(9,9);assert.equal(store.size,2);
  assert.deepEqual(store.prune().sort(),['9,9']);assert.equal(store.size,1);
  store.set(1,-1,new Uint8ClampedArray(4));store.prune();assert.equal(store.size,0);assert.equal(store.bounds,null);
  store.set(-1,-1,null);assert.equal(store.size,0);
  store.freeze();const tile=store.get(-3,0)??store.writable(-3,0);assert.equal(tile.frozen,false);
});

test('a stroke crossing tile boundaries and negative coordinates matches its positive-space copy',()=>{
  const a=new TileStore(),b=new TileStore(),run=(store,dx,dy)=>{
    const s=new DrawingStroke(store,{size:16,color:[10,20,30],pressureSize:false,hardness:.5,flow:.7,opacity:.8});
    s.sample({x:dx,y:dy});s.sample({x:dx+30,y:dy+10});s.sample({x:dx+60,y:dy-20});return s.finish();
  };
  run(a,300,300);run(b,-84,-84); // same dab positions shifted -384px (6 tiles)
  assert.ok([...b].some(t=>t.tx<0||t.ty<0),'expected tiles at negative coordinates');
  assert.deepEqual(a.readRect(250,240,140,110),b.readRect(-134,-144,140,110));
});

test('stroke undo restores null for newly allocated tiles and reapplies exactly',()=>{
  const store=new TileStore();
  const s=new DrawingStroke(store,{size:12,color:[255,0,0],pressureSize:false});
  s.sample({x:-70,y:-30});s.sample({x:-10,y:-50});const changes=s.finish();
  assert.ok(changes.length>=2&&changes.every(c=>c.before===null));
  applyTileChanges(store,changes,'before');
  for(const c of changes)assert.ok(!store.has(c.tx,c.ty));
  assert.equal(store.bounds,null);
  applyTileChanges(store,changes,'after');
  assert.ok(store.pixel(-70,-30)[3]>0);
});

test('floodTiles stays inside its bounds, closes gaps and allocates only touched tiles',()=>{
  const wall=new Uint8ClampedArray(10*10*4);for(let y=0;y<10;y++)if(y!==5)wall.set([0,0,0,255],(y*10+5)*4);
  const leaky=new TileStore();leaky.writeRect(0,0,10,10,wall);
  floodTiles(leaky,{x:0,y:0,color:[255,0,0,255],tolerance:0,bounds:{x:0,y:0,width:10,height:10}});
  assert.equal(leaky.pixel(0,0)[3],255);assert.equal(leaky.pixel(9,5)[3],255);assert.equal(leaky.size,1);
  const sealed=new TileStore();sealed.writeRect(0,0,10,10,wall);
  floodTiles(sealed,{x:0,y:0,color:[255,0,0,255],tolerance:0,gap:1,bounds:{x:0,y:0,width:10,height:10}});
  assert.equal(sealed.pixel(9,5)[3],0);assert.equal(sealed.pixel(9,9)[3],0);
  // A seed outside the bounds rect is rejected silently.
  const empty=new TileStore();floodTiles(empty,{x:500,y:0,color:[1,2,3,255],bounds:{x:0,y:0,width:10,height:10}});assert.equal(empty.size,0);
  assert.throws(()=>floodTiles(empty,{x:0,y:0,bounds:{x:0,y:0,width:8192,height:8193}}),/bounds/);
});

test('lassoMask allocates only the polygon bounding box',()=>{
  const mask=lassoMask([{x:10,y:20},{x:40,y:20},{x:40,y:50},{x:10,y:50}]);
  assert.deepEqual({x:mask.x,y:mask.y,width:mask.width,height:mask.height},{x:10,y:20,width:30,height:30});
  assert.equal(mask.mask.length,900);assert.equal(mask.mask.reduce((a,b)=>a+b,0),900);
  const small=lassoMask([{x:1,y:1},{x:2,y:1}]);assert.equal(small.mask.reduce((a,b)=>a+b,0),0);
});

test('tile blobs round-trip exact RGBA at negative coordinates and skip transparent tiles',async()=>{
  const store=new TileStore(),px=new Uint8ClampedArray(TILE_BYTES);
  px.set([1,2,3,4],0);px.set([200,100,50,255],(33*64+17)*4);px.set([9,9,9,128],TILE_BYTES-4);
  store.set(-3,2,px);store.set(0,-1,new Uint8ClampedArray([77,88,99,255]));
  store.writable(7,7).pixels.set([5,5,5,0],0); // transparent: must be skipped
  const url=await encodeTileBlob(store);assert.ok(url.startsWith(TILE_BLOB_PREFIX));
  const tiles=await decodeTileBlob(url);assert.equal(tiles.length,2);
  const map=new Map(tiles.map(t=>[tileKey(t.tx,t.ty),t]));
  assert.deepEqual([...map.get('-3,2').pixels],[...px]);
  assert.ok([...map.get('0,-1').pixels].every((n,i)=>n===[77,88,99,255][i%4]));
  assert.ok(map.get('0,-1').png?.length);
  const bad=TILE_BLOB_PREFIX+btoa('STYT');
  await assert.rejects(decodeTileBlob(bad),/tile blob/);
});

test('v1 to v2 migration preserves pixel world positions with rotated, mirrored and reversed poses',async()=>{
  const {e,resources}=fixture();try{
    const {figure:v1}=await legacyFigure(),migrated=migrateDrawingFigure(v1,99,{bounds:{x:0,y:0,width:96,height:64}});
    assert.equal(drawingMetadata(migrated).version,2);assert.ok(/^cel-/.test(drawingMetadata(migrated).celId));
    for(const mirror of [0,1])for(const reverse of [0,1]){
      const object={...createObject(v1,7,0,0),angle_rad:.8,angles:[.8],scale:1.5,image_text_flags:0};
      for(const f of [v1,migrated])f.segments[0].extra_u8_a=reverse,f.segments[0].extra_u8_b=mirror;
      const item=f=>buildGeometry({...e.report,figure_types:[f]},createFrame([{...object,figure_type_id:f.figure_type_id}])).drawables[0];
      const a=transformPoint(drawingMatrix(item(v1)),{x:50.25,y:60.75}),b=transformPoint(drawingPixelMatrix(item(migrated)),{x:50.25,y:60.75});
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8,`mirror=${mirror} reverse=${reverse}`);
    }
  }finally{resources.dispose();}
});

test('v1 cels decode into tiles at crop offsets through the resource store',async()=>{
  const {e,resources}=fixture();try{
    const {figure:v1,pixels}=await legacyFigure({figureTypeId:50});
    e.report.figure_types.push(v1);
    const entry=await resources.surface(v1);
    assert.deepEqual(entry.store.bounds,{x:0,y:0,width:96,height:64});
    assert.deepEqual([...entry.store.readRect(0,0,96,64)],[...pixels]);
  }finally{resources.dispose();}
});

test('copyDrawingFigure plus a resource fork shares tiles until only the edited tile diverges',async()=>{
  const {e,resources}=fixture();try{
    const {target,surface}=await stroke(e);e.extendDrawing(undefined,9);e.seek(5);e.drawingKey();const copy=e.drawingTarget();
    assert.notEqual(drawingMetadata(copy.figure).celId,drawingMetadata(target.figure).celId);
    const s1=resources.entry(target.figure).store,s2=resources.entry(copy.figure).store;
    assert.notEqual(s1,s2);assert.ok(s2.size>0);
    assert.ok([...s2].every(t=>s1.get(t.tx,t.ty)===t),'forked tiles are shared');
    assert.ok([...s1].every(t=>t.frozen));
    const brush=new DrawingStroke(s2,{size:8,pressureSize:false});brush.sample({x:70,y:20});const changes=brush.finish();
    e.commitDrawingPixels(copy,changes);
    const diverged=new Set(changes.map(c=>tileKey(c.tx,c.ty)));
    for(const t of s2)assert.equal(s1.get(t.tx,t.ty)===t,!diverged.has(tileKey(t.tx,t.ty)));
  }finally{resources.dispose();}
});

test('commit, undo and redo restore exact tile pixels and bounds metadata',async()=>{
  const {e,resources}=fixture();try{
    const {surface}=await stroke(e);
    const figure=e.drawingTarget().figure,first=snapshotStore(surface.store),bounds1={...drawingMetadata(figure).bounds};
    assert.ok(bounds1.width>0);
    const brush=new DrawingStroke(surface.store,{size:8,pressureSize:false});brush.sample({x:60,y:50});
    e.commitDrawingPixels(e.drawingTarget(),brush.finish());
    assert.notDeepEqual(drawingMetadata(figure).bounds,bounds1);
    e.undo();
    const store=resources.entry(figure).store;
    assert.deepEqual(snapshotStore(store),first);assert.deepEqual(drawingMetadata(figure).bounds,bounds1);
    e.redo();
    assert.notDeepEqual(snapshotStore(resources.entry(figure).store),first);
    assert.notDeepEqual(drawingMetadata(figure).bounds,bounds1);
  }finally{resources.dispose();}
});

test('checkHistory rejects tile work that would exceed the resident budget',async()=>{
  const e=new Editor({demo:false,layerTimeline:true});
  const resources=new DrawingResources(e.report,{worker:workerStub(),tileBytes:1024});
  try{
    const tiles=[{tx:0,ty:0,before:null,after:new Uint8ClampedArray(TILE_BYTES)}];
    assert.throws(()=>resources.checkHistory({kind:'drawing-pixels',celId:'cel-x',tiles},'after'),/memory is full/);
  }finally{resources.dispose();}
});

test('validateDrawings accepts v1 and v2 figures and rejects malformed tile blobs',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);await resources.flush();
    validateDrawings(e.report);
    const {figure:v1}=await legacyFigure({figureTypeId:88});e.report.figure_types.push(v1);validateDrawings(e.report);
    const figure=e.drawingTarget().figure,asset=figure.image_assets[0];
    assert.ok(asset.styk_tiles?.startsWith(TILE_BLOB_PREFIX));
    const bad=structuredClone(figure);bad._styk.drawing.celId='cel-bad-2';bad.image_assets[0].styk_tiles='data:image/png;base64,AAAA';
    e.report.figure_types.push(bad);assert.throws(()=>validateDrawings(e.report),/tile blob/);e.report.figure_types.pop();
    const dup=structuredClone(figure);e.report.figure_types.push(dup);assert.throws(()=>validateDrawings(e.report),/unique/);e.report.figure_types.pop();
    drawingMetadata(figure).bounds={x:0,y:0,width:99999,height:1};
    assert.throws(()=>validateDrawings(e.report),/metadata/);
  }finally{resources.dispose();}
});

test('a hold edits its owning drawing, copy splits independently and mixed undo restores exact bytes',async()=>{
  const {e,resources}=fixture();try{
    const {target,surface}=await stroke(e),original=storePixels(surface.store);e.extendDrawing(undefined,9);e.seek(5);
    assert.equal(e.drawingTarget().key.tick,0);e.drawingKey();const copy=e.drawingTarget();
    assert.notEqual(drawingMetadata(copy.figure).celId,drawingMetadata(target.figure).celId);
    assert.equal(copy.object.unique_id,target.object.unique_id);assert.equal(copy.end,10);
    await stroke(e,70);assert.deepEqual(storePixels(resources.entry(target.figure).store),original);e.undo();e.undo();assert.equal(e.drawingTarget().key.tick,0);
    e.undo();e.undo();assert.equal(e.drawingTarget().figure,undefined);assert.equal(e.report.figure_types[0].name,'Walker');e.redo();assert.deepEqual(storePixels(resources.entry(target.figure).store),original);
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
  const store=new TileStore(),b=new DrawingStroke(store,{size:20,opacity:.5,flow:1,pressureSize:false});
  for(let i=0;i<8;i++)b.dab({x:20,y:20});assert.equal(store.pixel(20,20)[3],128);
  b.cancel();assert.equal(store.size,0);
  const full=new Uint8ClampedArray(64*64*4).fill(255);store.writeRect(0,0,64,64,full);
  const eraser=new DrawingStroke(store,{size:20,opacity:.5,erase:true,pressureSize:false});for(let i=0;i<8;i++)eraser.dab({x:20,y:20});assert.equal(store.pixel(20,20)[3],128);
  const tiles=eraser.finish();applyTileChanges(store,tiles,'before');assert.deepEqual(store.readRect(0,0,64,64),full);
});
test('long strokes spanning tiles are never refused; rollback restores every touched tile',()=>{
  const store=new TileStore(),stroke=new DrawingStroke(store,{size:8,maxBytes:33088});stroke.sample({x:10,y:20});
  // Midpoint interpolation lags half a segment: the second tile is touched
  // once the next push curves through it. The former undo-budget throw is
  // gone: authored strokes always finish, and cancel() still restores.
  stroke.sample({x:100,y:20});stroke.sample({x:190,y:20});
  assert.ok(store.size>=2);stroke.cancel();assert.equal(store.size,0);
});
test('an unstabilized jittery stroke paints a continuous curve through its corner',()=>{
  const store=new TileStore(),s=new DrawingStroke(store,{size:8,color:[0,0,0],pressureSize:false,stabilization:0,spacingRatio:.2});
  const pts=[{x:20,y:20,pressure:1,time:0}];
  let x=20,y=20;
  for(let i=1;i<=20;i++)pts.push({x:x+=4,y:y+(i%2?1.6:-1.6),pressure:1,time:i*8});
  const cx=x,cy=y; // a 90-degree turn: midpoint interpolation must still cover it
  for(let i=1;i<=20;i++)pts.push({x:cx,y:cy+i*4,pressure:1,time:(20+i)*8});
  for(const p of pts)s.sample(p);s.finish();
  const near=(x,y)=>{for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++)if(store.pixel(Math.round(x)+dx,Math.round(y)+dy)[3]>150)return true;return false;};
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/2));
    for(let j=0;j<=steps;j++)assert.ok(near(a.x+(b.x-a.x)*j/steps,a.y+(b.y-a.y)*j/steps),`gap near sample ${i}`);
  }
});
test('a heavily stabilized slow stroke follows its curve instead of stalling',()=>{
  const store=new TileStore(),s=new DrawingStroke(store,{size:10,color:[0,0,0],pressureSize:false,stabilization:.95,spacingRatio:.1,pixelsPerUnit:1});
  const pts=[];for(let i=0;i<=120;i++){const a=i/120*Math.PI*2;pts.push({x:200+20*Math.cos(a),y:200+20*Math.sin(a),pressure:1,time:i*50});}
  for(const p of pts)s.sample(p);s.finish();
  // Every raw point ends within half the averaging window of committed ink.
  const radius=Math.ceil(.95*48/2);
  const near=(x,y)=>{for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(store.pixel(Math.round(x)+dx,Math.round(y)+dy)[3]>100)return true;return false;};
  let covered=0;for(const p of pts)if(near(p.x,p.y))covered++;
  assert.ok(covered/pts.length>.9,`only ${covered}/${pts.length} raw points near ink`);
  let painted=0,b=store.bounds;for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++)if(store.pixel(x,y)[3]>100)painted++;
  assert.ok(painted>120,`a slow stroke deposits real ink, not a dot (${painted}px)`);
});
test('the stroke ends exactly on the final input at any stabilization',()=>{
  for(const stabilization of [0,.95]){
    const store=new TileStore(),s=new DrawingStroke(store,{size:6,pressureSize:false,stabilization,pixelsPerUnit:1});
    s.sample({x:10,y:10});s.sample({x:30,y:16});s.sample({x:47.3,y:22.6});s.finish();
    const hit=Math.max(store.pixel(47,22)[3],store.pixel(47,23)[3],store.pixel(48,22)[3],store.pixel(48,23)[3]);
    assert.ok(hit>200,`stabilization ${stabilization} endpoint dab at the last sample`);
  }
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
test('sprite mapping inverts scale, rotation, mirror, reverse and crop anchor',()=>{
  for(const mirror of [0,1])for(const reverse of [0,1]){
    const angle=.7,item={asset:{anchor_start:{x:32,y:20},anchor_length:40,anchor_angle_rad:.2},seg:{extra_u8_a:reverse,extra_u8_b:mirror},obj:{},angle,start:{x:80,y:90},end:{x:80+80*Math.cos(angle),y:90+80*Math.sin(angle)}};
    const matrix=drawingMatrix(item),point={x:15.2,y:71.8},result=inversePoint(matrix,transformPoint(matrix,point));assert.ok(Math.abs(result.x-point.x)<1e-9&&Math.abs(result.y-point.y)<1e-9);
  }
});
test('malformed and duplicate drawing metadata is rejected',async()=>{
  const {e,resources}=fixture();try{const {target}=await stroke(e);validateDrawings(e.report);const copy=structuredClone(target.figure);e.report.figure_types.push(copy);assert.throws(()=>validateDrawings(e.report),/unique/);e.report.figure_types.pop();drawingMetadata(e.report.figure_types.at(-1)).bounds={x:0,y:0,width:0,height:1};assert.throws(()=>validateDrawings(e.report),/metadata/);}finally{resources.dispose();}
});
test('pressure release cannot remove paint laid earlier in the same stroke',()=>{
  const store=new TileStore(),b=new DrawingStroke(store,{size:16,pressureSize:false,pressureOpacity:true,flow:1});
  b.dab({x:16,y:16,pressure:1});const before=store.readRect(0,0,32,32);b.dab({x:16,y:16,pressure:.1});assert.deepEqual(store.readRect(0,0,32,32),before);
});
test('clipboard captures pending pixels once and remains independent of later source edits',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);e.sheetCopyFrames([e.activeLayerId],0,0);const source=e.drawingTarget(),original=storePixels(resources.entry(source.figure).store);
    await stroke(e,80);const layer=e.createDrawingLayer('Pasted');e.sheetPasteFrames([layer.id],0);const pasted=await resources.surface(e.drawingTarget().figure);
    assert.deepEqual(storePixels(pasted.store),original);assert.notEqual(e.drawingTarget().figure._styk.drawing.celId,source.figure._styk.drawing.celId);
    await stroke(e,100);assert.notDeepEqual(storePixels(resources.entry(source.figure).store),storePixels(pasted.store));
  }finally{resources.dispose();}
});
test('history restores tile snapshots synchronously after a published store is evicted',async()=>{
  const {e,resources}=fixture();try{
    const {surface}=await stroke(e),first=storePixels(surface.store);await resources.flush();
    await stroke(e,80);resources.entry(e.drawingTarget().figure).store=null;
    e.undo();const restored=await resources.surface(e.drawingTarget().figure);assert.deepEqual(storePixels(restored.store),first);
    e.redo();assert.notDeepEqual(storePixels(restored.store),first);
  }finally{resources.dispose();}
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
  const {e,resources}=fixture();try{await stroke(e);const figure=e.drawingTarget().figure,entry=resources.entry(figure),revision=e.revision,pixels=storePixels(entry.store);let calls=0;
    const inner=workerStub();resources.worker={async request(kind,data){if(!calls++)throw new Error('encoder failure');return inner.request(kind,data);},dispose(){}};
    await assert.rejects(resources.flush(),/encoder failure/);assert.notEqual(entry.published?.revision,entry.revision);assert.deepEqual(storePixels(entry.store),pixels);assert.equal(e.revision,revision);
    await resources.flush();assert.equal(entry.published.revision,entry.revision);assert.equal(e.revision,revision);
    assert.ok(figure.image_assets[0].styk_tiles?.startsWith(TILE_BLOB_PREFIX));
  }finally{resources.dispose();}
});
test('out-of-order encode results never replace newer committed tiles',async()=>{
  const {e,resources}=fixture();try{await stroke(e);let release,calls=0;const inner=workerStub();resources.worker={request(){calls++;if(calls===1)return new Promise(resolve=>release=resolve);return inner.request('encode-tiles',arguments[1]);},dispose(){}};
    const pending=resources.flush();await stroke(e,80);const entry=resources.entry(e.drawingTarget().figure),latest=storePixels(entry.store);release({tiles:[]});await pending;
    assert.equal(calls,2);assert.equal(entry.published.revision,entry.revision);assert.deepEqual(storePixels(entry.store),latest);
  }finally{resources.dispose();}
});
test('uniform full-region fill history is compact and restores exact RGBA',()=>{
  const store=new TileStore(),rect={x:0,y:0,width:1984,height:1152},before=new Map();
  for(const [tx,ty] of TileStore.tilesInRect(rect.x,rect.y,rect.width,rect.height))before.set(tileKey(tx,ty),null);
  const after=new Uint8ClampedArray(rect.width*rect.height*4);new Uint32Array(after.buffer).fill(0x7F461E5A);store.writeRect(rect.x,rect.y,rect.width,rect.height,after);
  const tiles=tileChanges(store,before);assert.ok(pixelChangeBytes(tiles)<100000);
  applyTileChanges(store,tiles,'before');assert.equal(store.size,0);
  applyTileChanges(store,tiles,'after');assert.deepEqual(store.readRect(0,0,rect.width,rect.height),after);
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
test('high-resolution brush tips retain their logical size instead of capping at 2048 pixels',()=>{
  const store=new TileStore(),brush=new DrawingStroke(store,{size:4096,pressureSize:false,maxBytes:256*1024*1024});
  brush.dab({x:1100,y:1});assert.equal(store.pixel(2190,0)[3],255);
});
test('v2 cels place pixel (0,0) at the pointer world position independently of stage size',async()=>{
  const {e,resources}=fixture();try{
    e.report.canvas_width=8000;e.report.canvas_height=8000;
    const target=e.prepareDrawingCel({pixelsPerUnit:4,world:{x:3000,y:-100}});
    assert.equal(target.figure._styk.drawing.pixelsPerUnit,4);assert.equal(target.figure._styk.drawing.version,2);
    const item=buildGeometry({...e.report,figure_types:[...e.report.figure_types,target.figure]},createFrame([target.object])).drawables[0];
    const origin=transformPoint(drawingPixelMatrix(item),{x:0,y:0});
    assert.ok(Math.hypot(origin.x-3000,origin.y+100)<1e-8);
    validateDrawings({...e.report,figure_types:[...e.report.figure_types,target.figure]});
  }finally{resources.dispose();}
});

// The stroke worker's engine runs in-process here; the browser tests exercise
// the real worker. The driver mirrors the controller: the stroke path runs on
// the caller's side, and each batch carries its dabs plus every store tile
// those dabs can reach that the worker has not seen for this stroke yet. The
// final batch carries the dabs the path emits when it finishes.
function strokeDrive(engine,id,settings,chunks,{store=new TileStore(),apply=false}={}){
  const sent=new Set(),replies=[],brush=normalizeBrush(settings);let pending=[];
  const path=new StrokePath(brush,dab=>pending.push(dab));
  engine.begin(id,settings);let seq=0;
  const flush=()=>{
    const dabs=pending,tiles=[];pending=[];
    for(const dab of dabs){const [x0,y0,x1,y1]=dabExtent(brush,dab);for(let ty=Math.floor(y0/TILE);ty*TILE<y1;ty++)for(let tx=Math.floor(x0/TILE);tx*TILE<x1;tx++){
      const key=tileKey(tx,ty);if(sent.has(key))continue;sent.add(key);
      const tile=store.get(tx,ty);tiles.push({tx,ty,pixels:tile?tile.pixels.slice().buffer:null});
    }}
    const reply=engine.dabs(id,++seq,dabs,tiles);replies.push(reply);
    // Like the controller, the live store adopts every returned tile.
    if(apply&&reply)for(const t of reply.tiles)store.set(t.tx,t.ty,new Uint8ClampedArray(t.pixels));
  };
  for(const samples of chunks){for(const p of samples)path.sample(p);flush();}
  path.finish();flush();
  return {replies,changes:engine.end(id)};
}
const replayFinal=(initial,changes)=>{const store=new TileStore();for(const [key,pixels] of initial){const [tx,ty]=key.split(',').map(Number);store.set(tx,ty,pixels);}applyTileChanges(store,changes,'after');return store;};
const pathPoints=n=>Array.from({length:n},(_,i)=>({x:10+i*2.4,y:10+Math.sin(i/9)*40+i*1.3,pressure:.4+.6*(i%7)/6,time:i*8}));

test('stroke engine batches of 1, 3 and 17 samples produce byte-identical tiles',()=>{
  const seedStore=()=>{const store=new TileStore();const px=new Uint8ClampedArray(TILE_BYTES);for(let i=0;i<TILE*TILE;i++)px.set([30,60,90,200],i*4);store.set(1,0,px);store.set(2,1,px.slice());return store;};
  const samples=pathPoints(51),settings={size:14,color:[200,40,80],hardness:.6,flow:.8,texture:.4,seed:9,stabilization:.3,spacingRatio:.09};
  const chunk=n=>{const out=[];for(let i=0;i<samples.length;i+=n)out.push(samples.slice(i,i+n));return out;};
  const initial=snapshotStore(seedStore()),results=[1,3,17,51].map(n=>{const {changes}=strokeDrive(new StrokeEngine(),'s',settings,chunk(n),{store:seedStore()});return replayFinal(initial,changes);});
  for(const store of results.slice(1))assert.deepEqual(store.readRect(-64,-64,512,512),results[0].readRect(-64,-64,512,512));
  assert.ok(results[0].bounds&&results[0].size>4,'expected a multi-tile stroke');
});

test('a stabilized stroke crossing four tiles leaves no gaps along its path',()=>{
  const engine=new StrokeEngine(),settings={size:12,color:[0,0,0],stabilization:.5,spacingRatio:.08,pressureSize:false,seed:3};
  const samples=Array.from({length:40},(_,i)=>({x:8+i*5,y:12+i*3.2,pressure:1,time:i*8}));
  const {changes}=strokeDrive(engine,'s',settings,[samples]);
  const store=replayFinal(new Map(),changes);
  const near=(x,y)=>{for(let dy=-24;dy<=24;dy++)for(let dx=-24;dx<=24;dx++)if(store.pixel(Math.round(x)+dx,Math.round(y)+dy)[3]>200)return true;return false;};
  for(let i=0;i<50;i++){const t=i/49,x=8+(8+39*5-8)*t,y=12+(12+39*3.2-12)*t;assert.ok(near(x,y),`gap near ${x},${y}`);}
});

test('a tap yields one dab and the final dab lands exactly on the last input',()=>{
  const engine=new StrokeEngine(),settings={size:10,color:[9,9,9],pressureSize:false,spacingRatio:1,stabilization:.6,seed:1};
  const tap=strokeDrive(engine,'tap',settings,[[{x:33,y:41,pressure:1,time:0}]]);
  const tapStore=replayFinal(new Map(),tap.changes);
  assert.ok(tapStore.pixel(33,41)[3]>200);
  const drag=strokeDrive(engine,'drag',settings,[Array.from({length:6},(_,i)=>({x:20+i*30,y:20,pressure:1,time:i*16}))]);
  const dragStore=replayFinal(new Map(),drag.changes);
  assert.ok(dragStore.pixel(170,20)[3]>200,'the stabilized tail reaches the final input');
});

test('pencil texture is deterministic per seed and differs between seeds',()=>{
  const samples=pathPoints(30),settings={size:16,color:[40,40,40],texture:.6,spacingRatio:.05,hardness:.8,flow:1,pressureSize:false};
  const run=seed=>{const {changes}=strokeDrive(new StrokeEngine(),'s',{...settings,seed},[samples]);return replayFinal(new Map(),changes).readRect(0,0,256,256);};
  assert.deepEqual(run(5),run(5));assert.notDeepEqual(run(5),run(6));
  const flat={...settings,texture:0,seed:5};
  assert.deepEqual(replayFinal(new Map(),strokeDrive(new StrokeEngine(),'s',flat,[samples]).changes).readRect(0,0,256,256),replayFinal(new Map(),strokeDrive(new StrokeEngine(),'s',flat,[samples]).changes).readRect(0,0,256,256));
});

test('stroke engine replies carry only tiles changed by that batch and cancel returns nothing',()=>{
  const engine=new StrokeEngine(),settings={size:8,color:[1,2,3],pressureSize:false,seed:2};
  const {replies}=strokeDrive(engine,'s',settings,[[{x:10,y:10,pressure:1,time:0},{x:150,y:10,pressure:1,time:8}],[{x:150,y:150,pressure:1,time:16}]]);
  const keys=r=>new Set(r.tiles.map(t=>tileKey(t.tx,t.ty)));
  assert.ok(keys(replies[0]).has('0,0')&&keys(replies[0]).has('1,0'));
  // The midpoint curve from (80,10) toward (150,150) stays inside tiles
  // 1,0/2,0/2,1: tile 0,0 is untouched by this batch.
  assert.ok(keys(replies[1]).has('2,1')&&!keys(replies[1]).has('0,0'));
  assert.ok(replies[0].dirty.width%64===0&&replies[0].dirty.x%64===0);
  engine.begin('x',{size:8,pressureSize:false});engine.dabs('x',1,[{x:5,y:5}],[{tx:0,ty:0,pixels:null}]);
  engine.cancel('x');assert.equal(engine.end('x'),null);assert.equal(engine.dabs('x',2,[{x:9,y:9}],[]),null);
  engine.begin('y',{size:8,pressureSize:false});
  assert.ok(engine.dabs('y',2,[{x:5,y:5}],[{tx:0,ty:0,pixels:null}]));assert.equal(engine.dabs('y',1,[{x:9,y:9}],[]),null,'out-of-order batches are ignored');
});

test('stroke engine end records equal the diff between initial and final tiles',()=>{
  const initialStore=new TileStore(),px=new Uint8ClampedArray(TILE_BYTES);
  for(let i=0;i<TILE*TILE;i++)px.set([200,100,50,255],i*4);initialStore.set(0,0,px);
  const initial=snapshotStore(initialStore),samples=pathPoints(24),settings={size:18,color:[10,20,30],flow:1,seed:4,spacingRatio:.07};
  const {changes}=strokeDrive(new StrokeEngine(),'s',settings,[samples],{store:initialStore});
  const control=new TileStore();control.set(0,0,px.slice());
  const brush=new DrawingStroke(control,settings);for(const p of samples)brush.sample(p);brush.finish();
  const result=replayFinal(initial,changes);
  assert.deepEqual(result.readRect(-64,-64,384,384),control.readRect(-64,-64,384,384));
  applyTileChanges(result,changes,'before');
  assert.deepEqual(result.readRect(0,0,64,64),initialStore.readRect(0,0,64,64));
});

test('fast strokes over existing artwork never wipe tiles between batches, and undo restores them',()=>{
  // One sample per animation frame, far apart: each segment's curve crosses
  // tiles outside both batches' sample boxes. Those tiles must be seeded.
  for(const stabilization of [0,.6,.95]){
    const store=new TileStore(),red=new Uint8ClampedArray([255,0,0,255]);
    for(let ty=-1;ty<6;ty++)for(let tx=-1;tx<6;tx++)store.set(tx,ty,red);
    const initial=snapshotStore(store),before=store.readRect(-64,-64,448,448);
    const chunks=[[{x:10,y:10}],[{x:210,y:210}],[{x:300,y:300}],[{x:20,y:330}],[{x:330,y:15}]].map(c=>c.map((p,i)=>({...p,pressure:1,time:i})));
    const {changes}=strokeDrive(new StrokeEngine(),'fast',{size:8,color:[0,0,0],pressureSize:false,stabilization},chunks,{store,apply:true});
    const after=replayFinal(initial,changes),pixels=after.readRect(-64,-64,448,448);
    // Every pixel is either untouched red or blended toward the black ink:
    // no pixel may lose alpha, which is what a wiped tile looks like.
    let lost=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]<255||(pixels[i]>0&&pixels[i]<255&&pixels[i+1]!==0))lost++;
    assert.equal(lost,0,`stabilization ${stabilization}: ${lost} pixels lost their artwork`);
    let inked=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<40)inked++;
    assert.ok(inked>1500,'the stroke itself painted');
    applyTileChanges(after,changes,'before');
    assert.deepEqual(after.readRect(-64,-64,448,448),before,'undo restores the exact artwork');
  }
});

test('the stroke engine refuses a dab that reaches a tile it was never given',()=>{
  const engine=new StrokeEngine();engine.begin('s',{size:8,pressureSize:false});
  assert.throws(()=>engine.dabs('s',1,[{x:100,y:100,pressure:1}],[{tx:0,ty:0,pixels:null}]),/not loaded/);
  engine.begin('t',{size:8,pressureSize:false});
  assert.ok(engine.dabs('t',1,[{x:100,y:100,pressure:1}],[{tx:1,ty:1,pixels:null}]).tiles.length===1);
});

test('dab extents bound every painted pixel for jittered, scattered and elliptical tips',()=>{
  for(const settings of [{size:30,texture:1,seed:7},{size:20,scatter:2,seed:3},{size:40,roundness:.2,angle:35},{size:3,hardness:.2}]){
    const store=new TileStore(),brush=normalizeBrush({pressureSize:false,...settings}),stroke=new DrawingStroke(store,brush);
    const dabs=[];const path=new StrokePath(brush,d=>dabs.push(d));
    for(let i=0;i<40;i++)path.sample({x:100+i*7,y:100+Math.sin(i)*30});path.finish();
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const d of dabs){const e=dabExtent(brush,d);x0=Math.min(x0,e[0]);y0=Math.min(y0,e[1]);x1=Math.max(x1,e[2]);y1=Math.max(y1,e[3]);}
    stroke.dabList(dabs);const b=store.bounds;
    assert.ok(b.x>=x0&&b.y>=y0&&b.x+b.width<=x1&&b.y+b.height<=y1,JSON.stringify(settings));
  }
});

test('brush blend modes, alpha lock and selection masks composite like Krita',()=>{
  const paint=(settings,backdrop,{mask}={})=>{const store=new TileStore();if(backdrop)store.set(0,0,new Uint8ClampedArray(backdrop));const s=new DrawingStroke(store,{size:12,pressureSize:false,...settings},{mask});s.sample({x:32,y:32});s.finish();return store;};
  // Normal paint over opaque grey replaces it at full opacity.
  assert.deepEqual(paint({color:[200,0,0]},[128,128,128,255]).pixel(32,32),[200,0,0,255]);
  // Multiply darkens by the backdrop: 200*128/255 ≈ 100.
  assert.deepEqual(paint({color:[200,255,0],blend:'multiply'},[128,128,128,255]).pixel(32,32),[100,128,0,255]);
  // Screen lightens.
  assert.ok(paint({color:[200,0,0],blend:'screen'},[128,128,128,255]).pixel(32,32)[0]>200);
  // Behind never covers opaque artwork but fills transparent pixels.
  assert.deepEqual(paint({color:[0,0,255],blend:'behind'},[128,128,128,255]).pixel(32,32),[128,128,128,255]);
  assert.deepEqual(paint({color:[0,0,255],blend:'behind'},null).pixel(32,32),[0,0,255,255]);
  // Color keeps the backdrop's luminosity with the brush's hue.
  const colored=paint({color:[255,0,0],blend:'color'},[128,128,128,255]).pixel(32,32);assert.ok(colored[0]>colored[1]&&Math.abs(.3*colored[0]+.59*colored[1]+.11*colored[2]-128)<2);
  // Alpha lock preserves alpha, recolours only existing pixels, skips empty tiles.
  assert.deepEqual(paint({color:[0,255,0],alphaLock:true},[10,10,10,100]).pixel(32,32),[0,255,0,100]);
  assert.equal(paint({color:[0,255,0],alphaLock:true},null).size,0);
  // A selection mask clips coverage to the selected pixels only.
  const mask={x:0,y:0,width:32,height:64,mask:new Uint8Array(32*64).fill(1)};
  const masked=paint({color:[0,0,0]},null,{mask});
  assert.equal(masked.pixel(34,32)[3],0);assert.equal(masked.pixel(30,32)[3],255);
});

test('an elliptical tip follows its fixed angle and the stroke direction',()=>{
  const spread=(settings,samples)=>{const store=new TileStore(),s=new DrawingStroke(store,{size:40,pressureSize:false,roundness:.15,...settings});for(const p of samples)s.sample(p);s.finish();return store.bounds;};
  const flat=spread({angle:0},[{x:100,y:100}]),tall=spread({angle:90},[{x:100,y:100}]);
  assert.ok(flat.width>flat.height*3&&tall.height>tall.width*3);
  // A calligraphy nib that follows direction stays thin across a horizontal line.
  const along=spread({angleMode:'direction'},[{x:100,y:100},{x:140,y:100},{x:180,y:100},{x:220,y:100}]);
  assert.ok(along.height<14,'a direction-following nib stays narrow across its path');
});

test('a large publication streams in bounded chunks and round-trips every tile exactly',async()=>{
  const report={figure_types:[]},stub=workerStub(),kinds=[],worker={...stub,request:(kind,data,options)=>{kinds.push({kind,count:data.tiles?.length??0});return stub.request(kind,data,options);}};
  const resources=new DrawingResources(report,{worker});
  try{
    const figure=createDrawingFigure({pixelsPerUnit:1,figureTypeId:1});report.figure_types.push(figure);
    const tiles=[];for(let i=0;i<300;i++){const px=new Uint8ClampedArray(TILE_BYTES);for(let p=0;p<TILE*TILE;p++)px.set([i%256,(i*7)%256,p%256,255],p*4);tiles.push({tx:i%20,ty:Math.floor(i/20),pixels:px.buffer});}
    resources.install(figure,tiles);await resources.flush();
    const sends2=kinds.filter(k=>['encode-pngs','encode-tiles'].includes(k.kind));
    assert.ok(sends2.length>=3&&sends2.every(k=>k.count<=96),'publication was chunked');
    const decoded=await decodeTileBlob(figure.image_assets[0].styk_tiles),entry=resources.entry(figure);
    assert.equal(decoded.length,300);
    for(const t of decoded)assert.deepEqual(t.pixels,entry.store.get(t.tx,t.ty).pixels);
    assert.ok([...entry.store].every(t=>t.png),'every tile trusts its cached PNG afterwards');
  }finally{resources.dispose();}
});

test('incremental tile store bounds always equal a fresh recomputation',()=>{
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const store=new TileStore();
  for(let i=0;i<3000;i++){
    const tx=Math.floor(rnd()*6)-3,ty=Math.floor(rnd()*6)-3,op=rnd();
    if(op<.15)store.delete(tx,ty);
    else if(op<.25)store.set(tx,ty,new Uint8ClampedArray([1,2,3,rnd()<.3?0:200]));
    else{const px=new Uint8ClampedArray(TILE_BYTES);for(let k=Math.floor(rnd()*4);k>0;k--)px[(Math.floor(rnd()*TILE)*TILE+Math.floor(rnd()*TILE))*4+3]=255;op<.6?store.adopt(tx,ty,px):store.set(tx,ty,px);}
    if(i%3===0){const copy=new TileStore(new Map(store.tiles));assert.deepEqual(store.bounds,copy.bounds);assert.deepEqual(store.tileBounds,copy.tileBounds);}
  }
});

test('publishing trims clean stores back under the tile budget, keeping the current cel',async()=>{
  const report={figure_types:[]},resources=new DrawingResources(report,{worker:workerStub(),tileBytes:6*TILE_BYTES});
  try{
    const figures=[1,2,3].map(id=>{const f=createDrawingFigure({pixelsPerUnit:1,figureTypeId:id});report.figure_types.push(f);return f;});
    const tiles=n=>Array.from({length:n},(_,i)=>({tx:i,ty:0,pixels:new Uint8ClampedArray(TILE_BYTES).fill(200).buffer}));
    // Strokes adopt tiles without reserving: three 4-tile cels exceed the 6-tile budget.
    figures.forEach((f,i)=>{const e=resources.install(f,tiles(4));e.used=i;});
    await resources.flush();
    const stats=resources.stats;
    assert.ok(stats.bytes<=6*TILE_BYTES,'resident tiles fit the budget after publication');
    assert.ok(resources.entry(figures[2]).store,'the most recently used cel stays resident');
    assert.equal(resources.entry(figures[0]).store,null,'the least recently used clean cel was evicted');
  }finally{resources.dispose();}
});

test('a decoded cel arrives with worker-built mip levels equal to a fresh reduction',async()=>{
  const report={figure_types:[]},resources=new DrawingResources(report,{worker:workerStub()});
  try{
    const figure=createDrawingFigure({pixelsPerUnit:1,figureTypeId:1});report.figure_types.push(figure);
    const tiles=[];for(let i=0;i<40;i++){const px=new Uint8ClampedArray(TILE_BYTES);for(let p=0;p<TILE*TILE;p++)px.set([(i*37+p)%256,(i*11)%256,p%199,(p*7)%256],p*4);tiles.push({tx:i%8,ty:Math.floor(i/8),pixels:px.buffer});}
    resources.install(figure,tiles);await resources.flush();
    const entry=resources.entry(figure);entry.store=null;entry.levels=null;
    await resources.surface(figure);
    assert.ok(entry.levels?.length>=2,'levels arrive with the decoded tiles');
    const fresh={store:entry.store,levels:[]};
    for(let k=1;k<=entry.levels.length;k++){const got=entry.levels[k-1],want=levelStore(fresh,k);assert.equal(got.size,want.size);for(const t of want)assert.deepEqual(got.get(t.tx,t.ty).pixels,t.pixels);}
    // Using a level does not rebuild tiles the worker already produced.
    const before=entry.levels[0].get(0,0);assert.equal(levelStore(entry,1).get(0,0),before);
  }finally{resources.dispose();}
});

test('a sharded parallel decode merges into the same tiles and mip levels',async()=>{
  const report={figure_types:[]},resources=new DrawingResources(report,{worker:workerStub()});
  try{
    const figure=createDrawingFigure({pixelsPerUnit:1,figureTypeId:1});report.figure_types.push(figure);
    const tiles=[];for(let i=0;i<300;i++){const px=new Uint8ClampedArray(TILE_BYTES);for(let p=0;p<TILE*TILE;p++)px.set([(i*13+p)%256,(p>>6)*4,i%256,(i+p)%256],p*4);tiles.push({tx:(i%30)-12,ty:Math.floor(i/30)-4,pixels:px.buffer});}
    resources.install(figure,tiles);await resources.flush();
    const url=figure.image_assets[0].styk_tiles;
    const single=await resources.decodeWorker.request('decode-tiles',{url,levels:3});
    resources._encoders=[workerStub(),workerStub(),workerStub()];
    const merged=await resources.decodeTiles(url);
    const key=t=>t.tx+','+t.ty,map=list=>new Map(list.map(t=>[key(t),new Uint8Array(t.pixels)]));
    assert.deepEqual(map(merged.tiles),map(single.tiles));
    assert.equal(merged.levels.length,single.levels.length);
    merged.levels.forEach((list,k)=>assert.deepEqual(map(list),map(single.levels[k])));
  }finally{resources.dispose();}
});

test('the resident tile budget scales with device memory within bounds',()=>{
  assert.equal(defaultTileBudget(undefined),384*1024*1024);assert.equal(defaultTileBudget(2),192*1024*1024);assert.equal(defaultTileBudget(8),768*1024*1024);assert.equal(defaultTileBudget(64),768*1024*1024);
});

test('memory pressure evicts the cels farthest from the playhead before recently used ones',async()=>{
  const report={figure_types:[]},resources=new DrawingResources(report,{worker:workerStub(),tileBytes:9*TILE_BYTES});
  try{
    const figures=[1,2,3,4].map(id=>{const f=createDrawingFigure({pixelsPerUnit:1,figureTypeId:id});report.figure_types.push(f);return f;});
    const tiles=()=>Array.from({length:3},(_,i)=>({tx:i,ty:0,pixels:new Uint8ClampedArray(TILE_BYTES).fill(90).buffer}));
    // The far cel was used most recently; LRU alone would keep it.
    const ids=figures.map(f=>drawingMetadata(f).celId);
    figures.forEach((f,i)=>{const e=resources.install(f,tiles());e.used=[10,20,30,40][i];});
    resources.distances=()=>new Map([[ids[0],1],[ids[1],0],[ids[2],2],[ids[3],50]]);
    await resources.flush();
    assert.equal(resources.entry(figures[3]).store,null,'the far cel is evicted first');
    assert.ok(resources.entry(figures[1]).store&&resources.entry(figures[0]).store,'cels beside the playhead stay resident');
  }finally{resources.dispose();}
});

test('the smudge brush drags colour, batches deterministically and undoes exactly',()=>{
  const seed=()=>{const store=new TileStore();for(let ty=0;ty<2;ty++){store.set(0,ty,new Uint8ClampedArray([255,0,0,255]));store.set(1,ty,new Uint8ClampedArray([0,0,255,255]));}return store;};
  const samples=Array.from({length:24},(_,i)=>({x:20+i*4,y:64,pressure:1,time:i}));
  const settings={size:20,hardness:.5,blend:'smudge',smudgeLength:.9,pressureSize:false,spacingRatio:.1,color:[0,0,0]};
  const runs=[1,5,24].map(n=>{const store=seed(),initial=snapshotStore(store),chunks=[];for(let i=0;i<samples.length;i+=n)chunks.push(samples.slice(i,i+n));const {changes}=strokeDrive(new StrokeEngine(),'s',settings,chunks,{store});return {result:replayFinal(initial,changes),changes,initial};});
  for(const r of runs.slice(1))assert.deepEqual(r.result.readRect(0,0,128,128),runs[0].result.readRect(0,0,128,128));
  const pulled=runs[0].result.pixel(80,64);assert.ok(pulled[0]>100&&pulled[2]<200,'red is dragged into the blue half');
  assert.deepEqual(runs[0].result.pixel(120,10),[0,0,255,255],'untouched paint stays');
  applyTileChanges(runs[0].result,runs[0].changes,'before');assert.deepEqual(runs[0].result.readRect(0,0,128,128),seed().readRect(0,0,128,128));
  // Colour rate mixes the brush colour into the carried paint.
  const mix=seed(),s=new DrawingStroke(mix,{...settings,colorRate:.6,color:[0,255,0]});for(const p of samples)s.sample(p);s.finish();
  assert.ok(mix.pixel(80,64)[1]>80,'colour rate adds the brush colour');
});

test('gradients interpolate premultiplied, respect the selection and stay dither-bounded',()=>{
  const store=new TileStore(),bounds={x:0,y:0,width:128,height:64};
  gradientTiles(store,{bounds,a:{x:0,y:32},b:{x:128,y:32},from:[255,0,0,255],to:[255,0,0,0]});
  const left=store.pixel(2,10),mid=store.pixel(64,10),right=store.pixel(126,10);
  assert.ok(left[3]>245&&Math.abs(mid[3]-128)<=3&&right[3]<8,'alpha ramps across the gradient');
  assert.ok(mid[0]>=253&&mid[1]<=1,'a colour-to-transparent ramp keeps its hue (premultiplied)');
  const radial=new TileStore();gradientTiles(radial,{bounds,a:{x:64,y:32},b:{x:64,y:0},type:'radial',from:[0,0,255,255],to:[0,255,0,255]});
  assert.ok(radial.pixel(64,32)[2]>240&&radial.pixel(64,1)[1]>230,'radial runs centre to edge');
  const mask={x:0,y:0,width:64,height:64,mask:new Uint8Array(64*64).fill(1)},clipped=new TileStore();
  gradientTiles(clipped,{bounds,a:{x:0,y:0},b:{x:128,y:0},from:[9,9,9,255],to:[9,9,9,255],mask});
  assert.equal(clipped.pixel(100,10)[3],0);assert.equal(clipped.pixel(10,10)[3],255);
});

// Phase 3: mip levels, tile-anchored scratch, budgets and the shared provider.
// TileStore.set accepts a 4-byte colour as a uniform tile fill.
const px=(tile,x,y)=>[...tile.pixels.slice((y*TILE+x)*4,(y*TILE+x)*4+4)];

test('level tiles are 2x2 premultiplied box averages with clean alpha edges',()=>{
  const store=new TileStore(),entry={store,levels:[]};
  // Source px(0,0)=opaque red, px(1,0)=half green, a 2x2 opaque blue block at
  // (32..33,32..33), everything else transparent.
  const p=new Uint8ClampedArray(TILE_BYTES);p.set([255,0,0,255],0);p.set([0,255,0,128],4);
  for(let y=32;y<34;y++)for(let x=32;x<34;x++)p.set([0,0,255,255],(y*TILE+x)*4);
  store.set(0,0,p);
  const tile=levelStore(entry,1).get(0,0);
  assert.ok(tile,'the covering level tile exists');
  // a=Math.round(383/4)=96, r=Math.round(65025/383)=170, g=Math.round(32640/383)=85
  assert.deepEqual(px(tile,0,0),[170,85,0,96]);
  // Fully transparent 2x2 groups stay exactly zero (no hue bleed at alpha edges).
  assert.deepEqual(px(tile,1,1),[0,0,0,0]);
  // A solid 2x2 group of opaque blue averages to opaque blue exactly.
  assert.deepEqual(px(tile,16,16),[0,0,255,255]);
});

test('level invalidation drops only the covering tiles after a source change',()=>{
  const store=new TileStore(),entry={store,levels:[]};
  store.set(0,0,new Uint8ClampedArray([255,0,0,255]));store.set(4,4,new Uint8ClampedArray([0,255,0,255]));
  const level=levelStore(entry,1),a=level.get(0,0),b=level.get(2,2);
  assert.deepEqual(px(a,0,0),[255,0,0,255]);assert.deepEqual(px(b,0,0),[0,255,0,255]);
  store.set(0,0,new Uint8ClampedArray([0,0,255,255]));
  invalidateLevels(entry,{x:0,y:0,width:64,height:64});
  const next=levelStore(entry,1);
  assert.equal(next.get(2,2),b,'unrelated level tiles keep their cache entry');
  assert.notEqual(next.get(0,0),a,'the covering level tile was rebuilt');
  assert.deepEqual(px(next.get(0,0),0,0),[0,0,255,255]);
});

test('a level store repopulated after an empty read reports fresh bounds',()=>{
  const store=new TileStore(),entry={store,levels:[]};
  // Reads on the still-empty level cache empty bounds; lazy repopulation must
  // invalidate them or every mip render sees zero coverage.
  const empty=levelStore(entry,1);
  assert.equal(empty.tileBounds,null);
  store.set(0,0,new Uint8ClampedArray([255,0,0,255]));
  const level=levelStore(entry,1);
  assert.equal(level,empty,'the same level store is repopulated in place');
  assert.deepEqual(level.tileBounds,{x:0,y:0,width:64,height:64});
  assert.ok(level.bounds,'alpha bounds refresh too');
});

const stubScratchCanvases=()=>{
  globalThis.OffscreenCanvas??=class{constructor(w,h){this.width=w;this.height=h;this.painted=[];}getContext(){const canvas=this;return this._ctx??={clearRect(){},putImageData:(img,x,y)=>canvas.painted.push({x,y,pixels:img.data.slice()}),drawImage(){},getImageData(){return{data:new Uint8ClampedArray(this.width*4)}}};}};
  globalThis.ImageData??=class{constructor(pixels,w,h){this.data=pixels;this.width=w;this.height=h;}};
};

test('oversized coverage still renders: mip escalation fits, clamp guarantees a scratch',()=>{
  stubScratchCanvases();
  // Tiles 2000 cells apart: ~128k px of coverage, beyond every old mip cap.
  const store=new TileStore();store.set(0,0,new Uint8ClampedArray([1,2,3,255]));store.set(2000,0,new Uint8ClampedArray([4,5,6,255]));
  const presenter={id:'cel-huge',store,stamp:1,level:k=>levelStore(presenter,k)};
  const rect={x:0,y:0,width:129000,height:64};
  let s=null,level=-1;
  for(let k=0;k<=8;k++){s=presenterScratch(presenter,rect,{level:k,maxSide:4096});if(s){level=k;break;}}
  assert.ok(s,'a fitting mip level always exists');
  assert.ok(level>0&&level<=8,`escalated to level ${level}`);
  // clamp guarantees a scratch even without escalation, trimmed to maxSide.
  const clamped=presenterScratch(presenter,rect,{level:0,maxSide:4096,clamp:true});
  assert.ok(clamped&&clamped.width<=4096&&clamped.height<=4096,'clamped scratch fits the texture limit');
});

test('presenter scratch anchors on tiles: sub-tile pans reuse, stamps reblit dirty tiles only',()=>{
  stubScratchCanvases();
  const store=new TileStore();store.set(0,0,new Uint8ClampedArray([10,20,30,255]));store.set(1,0,new Uint8ClampedArray([40,50,60,255]));store.set(4,0,new Uint8ClampedArray([70,80,90,255]));store.set(5,0,new Uint8ClampedArray([1,2,3,255]));
  const presenter={id:'cel-t',store,stamp:1,level:k=>levelStore(presenter,k)};
  // The visible rect plus one tile of margin, clamped to coverage {0,0,384,64}.
  const first=presenterScratch(presenter,{x:10,y:10,width:60,height:60});
  assert.equal(first.x%TILE,0);assert.equal(first.y%TILE,0);
  assert.deepEqual({x:first.x,y:first.y,width:first.width,height:first.height},{x:0,y:0,width:192,height:64});
  const scratch=presenter._scratches.get(first.anchorKey),blits=scratch.blits;
  // A sub-tile pan keeps the anchored rect and reblits nothing.
  const second=presenterScratch(presenter,{x:13,y:17,width:60,height:60});
  assert.equal(second.anchorKey,first.anchorKey);assert.equal(scratch.blits,blits);
  // A stamp change blits only the tiles intersecting the scratch's pending rect.
  presenter.stamp=2;scratch.pending={x:0,y:0,width:64,height:64};
  const third=presenterScratch(presenter,{x:13,y:17,width:60,height:60});
  assert.equal(third.anchorKey,first.anchorKey);assert.equal(scratch.blits,blits+1);
  assert.deepEqual(third.dirty,{x:0,y:0,width:64,height:64});
  // Zooming inside the painted cover reuses the canvas without repainting.
  const inner=presenterScratch(presenter,{x:30,y:20,width:40,height:30});
  assert.equal(inner.canvas,first.canvas);assert.equal(inner.anchorKey,first.anchorKey);assert.equal(scratch.blits,blits+1);
  // A rect beyond every painted cover anchors a second scratch; both persist.
  const fourth=presenterScratch(presenter,{x:250,y:10,width:60,height:60});
  assert.notEqual(fourth.anchorKey,first.anchorKey);assert.notEqual(fourth.canvas,first.canvas);
  const scratch2=presenter._scratches.get(fourth.anchorKey);
  assert.ok(scratch2.blits>0,'a re-anchored scratch repaints wholesale');
  assert.equal(fourth.dirty,null,'a re-anchored scratch uploads wholesale');
  // Alternating rects keep their own canvases: returning to the first rect
  // hits its cover hysteresis instead of repainting a shared canvas.
  const fifth=presenterScratch(presenter,{x:10,y:10,width:60,height:60});
  assert.equal(fifth.canvas,first.canvas);assert.equal(scratch.blits,blits+1);
  assert.equal(presenter._scratches.size,2);
});

test('present() marks a per-scratch pending rect at its own mip level',async()=>{
  stubScratchCanvases();
  const {e,resources}=fixture();try{
    const {target}=await stroke(e),entry=resources.presenter(target.figure);
    const first=presenterScratch(entry,{x:0,y:0,width:200,height:60});
    const scratch=entry._scratches.get(first.anchorKey),blits=scratch.blits;
    resources.present(entry,{x:0,y:0,width:8,height:8});
    const second=presenterScratch(entry,{x:0,y:0,width:200,height:60});
    assert.equal(second.canvas,first.canvas);assert.equal(scratch.blits,blits+1,'only the covering tile repaints');
    assert.deepEqual(second.dirty,{x:0,y:0,width:64,height:64});
    assert.equal(scratch.pending,null,'the repaint consumed the pending rect');
  }finally{resources.dispose();}
});

test('resource eviction frees scratch, then levels, then published stores',()=>{
  const report={figure_types:[]},resources=new DrawingResources(report,{worker:workerStub(),tileBytes:3*TILE_BYTES});
  try{
    const fig=id=>{const f=createDrawingFigure({celId:id});report.figure_types.push(f);return f;};
    const [a,b,c]=[fig('cel-a'),fig('cel-b'),fig('cel-c')];
    const ea=resources.entry(a),eb=resources.entry(b),ec=resources.entry(c);
    ea.store=new TileStore();ea.store.set(0,0,new Uint8ClampedArray([1,2,3,255]));ea.published={revision:0};ea.used=1;
    eb.store=new TileStore();eb.store.set(0,0,new Uint8ClampedArray([1,2,3,255]));eb.published={revision:0};eb.used=2;
    ec.store=new TileStore();ec.store.set(0,0,new Uint8ClampedArray([1,2,3,255]));ec.used=3; // unpublished: never evicts
    ea._scratches=new Map([['0:0,0,64,64',{level:0,cover:{x:0,y:0,width:64,height:64},canvas:{width:64,height:64},ctx:null,stamp:0,pending:null,blits:0,used:0}]]);levelStore(eb,1);
    assert.equal(resources.stats.bytes,3*TILE_BYTES);
    resources.reserve(TILE_BYTES,null);
    assert.equal(ea._scratches,null);assert.equal(eb.levels,null);
    assert.equal(ea.store,null,'oldest published store evicts first');
    assert.ok(eb.store&&ec.store,'newer and unpublished stores survive');
    assert.equal(resources.stats.bytes,2*TILE_BYTES);
    // Required dirty work stays resident above the soft budget; only the hard
    // ceiling (4× the tile budget) still refuses.
    resources.reserve(3*TILE_BYTES,null);
    assert.ok(ec.store,'unpublished store survives over the soft budget');
    assert.throws(()=>resources.reserve(12*TILE_BYTES,null),/memory is full/);
  }finally{resources.dispose();}
});

test('a stroke over the remaining tile budget evicts clean stores instead of throwing',async()=>{
  const e=new Editor({demo:false,layerTimeline:true});e.report.canvas_width=64;e.report.canvas_height=64;
  const resources=new DrawingResources(e.report,{worker:workerStub(),tileBytes:4*TILE_BYTES});
  try{
    e.createDrawingLayer();
    const t1=e.prepareDrawingCel({pixelsPerUnit:1,world:{x:32,y:32}}),s1=await resources.surface(t1.figure);
    const b1=new DrawingStroke(s1.store,{size:8,pressureSize:false});b1.sample({x:40,y:40});e.commitDrawingPixels(t1,b1.finish());
    await resources.flush();
    const fig1=t1.figure;
    assert.equal(resources.entry(fig1).published?.revision,resources.entry(fig1).revision,'first cel published clean');
    e.extendDrawing(undefined,9);e.seek(5);e.drawingKey(undefined,5,{blank:true});
    const t2=e.prepareDrawingCel({pixelsPerUnit:1,world:{x:32,y:32}}),s2=await resources.surface(t2.figure);
    // Four touched tiles + the resident cel exceed the 4-tile budget: the
    // clean store must evict rather than rejecting the edit.
    const b2=new DrawingStroke(s2.store,{size:48,pressureSize:false});
    b2.sample({x:32,y:32});b2.sample({x:230,y:32});
    e.commitDrawingPixels(t2,b2.finish());
    assert.equal(resources.entry(fig1).store,null,'the published-clean store evicted to make room');
    assert.equal(resources.entry(e.drawingTarget().figure).store.size,4);
  }finally{resources.dispose();}
});

test('presenter() kicks a re-decode when the published store was evicted',async()=>{
  const {e,resources}=fixture();try{
    const {target}=await stroke(e);await resources.flush();
    const figure=target.figure,entry=resources.entry(figure);
    entry.store=null;
    assert.equal(resources.presenter(figure),entry,'the presenter still resolves');
    assert.ok(entry.loading,'the missing store starts decoding again');
    await entry.loading;assert.ok(entry.store?.size>0);
    // A failed decode records decodeError instead of retrying every frame.
    entry.store=null;resources.decodeWorker={request:()=>Promise.reject(new Error('decode broke')),dispose(){}};
    resources.presenter(figure);await new Promise(r=>setTimeout(r,20));
    assert.ok(entry.decodeError,'a real decode failure is recorded');
    assert.equal(entry.loading,null);
    resources.presenter(figure);await new Promise(r=>setTimeout(r,20));
    assert.equal(entry.loading,null,'decodeError prevents a retry storm');
  }finally{resources.dispose();}
});

test('forking a cel does not double-count copy-on-write tiles in the byte stats',async()=>{
  const {e,resources}=fixture();try{
    const {target}=await stroke(e);e.extendDrawing(undefined,9);e.seek(5);
    const before=resources.stats.bytes;
    e.drawingKey(); // a copied key forks the store: tiles stay shared
    assert.equal(resources.stats.bytes,before,'shared tiles count once');
    const copy=e.drawingTarget(),s2=resources.entry(copy.figure).store;
    const b=new DrawingStroke(s2,{size:8,pressureSize:false});b.sample({x:70,y:20});e.commitDrawingPixels(copy,b.finish());
    assert.ok(resources.stats.bytes>before,'a diverged tile adds real bytes');
  }finally{resources.dispose();}
});

test('the drawing provider decodes published blobs and evicts LRU over budget',async()=>{
  const store=new TileStore();store.set(-1,0,new Uint8ClampedArray([7,8,9,200]));store.set(3,3,new Uint8ClampedArray([4,5,6,255]));
  const figure=id=>{const f=createDrawingFigure({celId:id});f._styk.drawing.revision=1;f._styk.drawing.bounds={...store.bounds};return f;};
  const blob=await encodeTileBlob(store);
  const provider=new DrawingTileProvider({budgetBytes:4*TILE_BYTES});
  try{
    const [a,b,c]=[figure('cel-a'),figure('cel-b'),figure('cel-c')];
    a.image_assets[0].styk_tiles=blob;b.image_assets[0].styk_tiles=blob;c.image_assets[0].styk_tiles=blob;
    await provider.prepare([a]);assert.equal(provider.presenter(a).store.pixel(-32,5)[3],200);
    assert.equal(provider.presenter(a).store.tileBounds.x,-64);
    await provider.prepare([b]);await provider.prepare([c]);
    assert.equal(provider.presenter(a),null,'LRU eviction released the oldest cel');
    assert.ok(provider.presenter(b)?.store&&provider.presenter(c)?.store);
    assert.ok(provider.bytes<=provider.budgetBytes);
    // A matching revision is a cache hit; a stale revision decodes again.
    await provider.prepare([b]);b._styk.drawing.revision=2;await provider.prepare([b]);
    assert.equal(provider.entries.get('cel-b').revision,2);
  }finally{provider.dispose();}
});

test('the drawing provider never serves a superseded revision',async()=>{
  const store=new TileStore();store.set(0,0,new Uint8ClampedArray([7,8,9,255]));
  const blob=await encodeTileBlob(store);
  const provider=new DrawingTileProvider();
  try{
    const figure=createDrawingFigure({celId:'cel-gate'});
    figure._styk.drawing.revision=1;figure._styk.drawing.bounds={...store.bounds};figure.image_assets[0].styk_tiles=blob;
    await provider.prepare([figure]);
    assert.equal(provider.presenter(figure)?.store?.pixel(5,5)?.[3],255);
    // A patch bumps the figure's revision before the worker re-decodes; the
    // stale store must not answer bounds or paint queries in between.
    figure._styk.drawing.revision=2;
    assert.equal(provider.presenter(figure),null);
    await provider.prepare([figure]);
    assert.equal(provider.presenter(figure)?.revision,2);
    assert.equal(provider.presenter(figure)?.store?.pixel(5,5)?.[3],255);
  }finally{provider.dispose();}
});

test('a v2 cel world bounds equal its tile bounds through drawingPixelMatrix',()=>{
  const figure=createDrawingFigure({celId:'cel-bounds'});
  // Tile bounds that also cover the segment endpoints, which objectBounds
  // unions with the image quad for every figure.
  figure._styk.drawing.bounds={x:-64,y:-64,width:384,height:192};
  const object=createObject(figure,7,120,-40,{scale:1.5});
  const item=buildGeometry({figure_types:[figure],canvas_width:640,canvas_height:480},createFrame([object])).drawables[0];
  const bounds=objectBounds([item],{}),matrix=drawingPixelMatrix(item),b=figure._styk.drawing.bounds;
  const corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>transformPoint(matrix,{x,y}));
  const x0=Math.min(...corners.map(p=>p.x)),y0=Math.min(...corners.map(p=>p.y)),x1=Math.max(...corners.map(p=>p.x)),y1=Math.max(...corners.map(p=>p.y));
  // objectBounds adds a 3px guard pad around painted geometry.
  assert.deepEqual(bounds,{x:Math.floor(x0-3),y:Math.floor(y0-3),width:Math.ceil(x1+3)-Math.floor(x0-3),height:Math.ceil(y1+3)-Math.floor(y0-3)});
});

test('flattening a tile store yields a PNG at source resolution with source-space anchors',async()=>{
  const store=new TileStore();store.set(1,1,new Uint8ClampedArray([9,9,9,255]));
  const flat=await flattenedDrawingPNG({store});
  assert.equal(flat.scale,1);assert.deepEqual({x:flat.x,y:flat.y},{x:64,y:64});
  const decoded=await decodeDrawingPNG(flat.dataUrl);
  assert.equal(decoded.width,64);assert.equal(decoded.height,64);assert.deepEqual([...decoded.pixels.slice(0,4)],[9,9,9,255]);
  const huge=new TileStore();huge.set(0,0,new Uint8ClampedArray([1,1,1,255]));huge.set(64,64,new Uint8ClampedArray([1,1,1,255])); // 4160px bounds
  const capped=await flattenedDrawingPNG({store:huge},{maxPixels:1024*1024});
  assert.equal(capped.level,3);assert.equal(capped.scale,8,'oversized bounds flatten at a mip level');
  assert.ok(capped.width*capped.height<=1024*1024);
});

test('publication re-encodes only changed tiles and resends PNGs the worker cache lost',async()=>{
  const {e,resources}=fixture();try{
    // A multi-tile cel: the dab trail at y=10 spans tiles 0..2 on x.
    const target=e.prepareDrawingCel({pixelsPerUnit:1,world:{x:32,y:32}}),surface=await e.drawingResources.surface(target.figure);
    const brush=new DrawingStroke(surface.store,{size:16,pressureSize:false});
    brush.sample({x:10,y:10});brush.sample({x:150,y:10});e.commitDrawingPixels(target,brush.finish());
    await resources.flush();
    const figure=e.drawingTarget().figure,entry=resources.entry(figure),size=entry.store.size;
    assert.ok(size>1);assert.equal(resources.stats.lastEncode.encoded,size,'first publish encodes every tile');
    // One-tile stroke: exactly one encode, every other PNG reused from the cache.
    const dab=new DrawingStroke(entry.store,{size:8,pressureSize:false});dab.sample({x:20,y:20});e.commitDrawingPixels(e.drawingTarget(),dab.finish());
    await resources.flush();
    assert.equal(resources.stats.lastEncode.encoded,1);assert.equal(resources.stats.lastEncode.reused,size-1);
    // Worker restart drops the whole encoded cache: the keep-list misses and
    // the main thread resends the still-valid PNG bytes once.
    resources.worker=workerStub();
    const dab2=new DrawingStroke(entry.store,{size:8,pressureSize:false});dab2.sample({x:30,y:30});e.commitDrawingPixels(e.drawingTarget(),dab2.finish());
    await resources.flush();
    assert.equal(resources.stats.lastEncode.encoded,size-1,'missing PNGs resent exactly once');
    const decoded=await decodeTileBlob(figure.image_assets[0].styk_tiles);
    assert.equal(decoded.length,entry.store.size);
    for(const t of decoded)assert.deepEqual([...t.pixels],[...entry.store.get(t.tx,t.ty).pixels]);
  }finally{resources.dispose();}
});

test('an edit larger than the remaining history evicts older commands; oversized edits still apply with exact undo',async()=>{
  const {e,resources}=fixture();try{
    await stroke(e);const firstBytes=e._undo.at(-1).bytes;
    const dab=x=>{const t=e.drawingTarget(),surface=resources.entry(t.figure);const b=new DrawingStroke(surface.store,{size:8,pressureSize:false});b.sample({x,y:40});e.commitDrawingPixels(t,b.finish());return e._undo.at(-1).bytes;};
    const strokeBytes=dab(100);dab(200);
    // Budget fits the creation batch plus two strokes, not three.
    e.historyBytes=firstBytes+2*strokeBytes+64;
    const before=e.revision;dab(300);
    assert.equal(e._undo.length,3,'the creation command was evicted, not rejected');
    assert.ok(e.historySize<=e.historyBytes);assert.ok(e.revision>before);
    e.undo();e.undo();assert.equal(e._undo.length,1,'undo stops at the evicted boundary');
    // An edit larger than the soft budget still applies and keeps an exact
    // record; eviction — never rejection — bounds history memory.
    e.historyBytes=64;
    const tiles=[{tx:9,ty:9,before:null,after:new Uint8ClampedArray(TILE_BYTES).fill(255)},{tx:10,ty:9,before:null,after:new Uint8ClampedArray(TILE_BYTES).fill(255)}];
    e.commitDrawingPixels(e.drawingTarget(),tiles);
    assert.equal(e._undo.at(-1).kind,'drawing-pixels');
    assert.equal(resources.entry(e.drawingTarget().figure).store.get(9,9)?.pixels.length,TILE_BYTES);
    e.undo();assert.equal(resources.entry(e.drawingTarget().figure).store.get(9,9),undefined);
  }finally{resources.dispose();}
});

test('undo after a published clean store is evicted by reserve() rebuilds exact pixels',async()=>{
  const {e,resources}=fixture();try{
    const {surface}=await stroke(e),first=storePixels(surface.store);await resources.flush();
    await stroke(e,80);await resources.flush();const figure=e.drawingTarget().figure,entry=resources.entry(figure);
    resources.reserve(resources.tileBudget);assert.equal(entry.store,null,'clean published store evicted');
    e.undo();const restored=await resources.surface(figure);assert.deepEqual(storePixels(restored.store),first);
    e.redo();assert.notDeepEqual(storePixels((await resources.surface(figure)).store),first);
  }finally{resources.dispose();}
});

test('a burst of surface requests keeps at most two decodes queued and decodes the newest',async()=>{
  const {e,resources}=fixture();try{
    const figures=[];
    for(let i=0;i<10;i++){
      const figure=createDrawingFigure({pixelsPerUnit:1,figureTypeId:100+i});figure._styk.drawing.celId=`cel-burst-${i}`;e.report.figure_types.push(figure);figures.push(figure);
      const pixels=new Uint8ClampedArray(TILE_BYTES);pixels.set([i,0,0,255],0);resources.install(figure,[{tx:0,ty:0,pixels}]);
    }
    await resources.flush();
    for(const figure of figures){const entry=resources.entry(figure);entry.store=null;assert.ok(entry.published?.url,'every cel published before eviction');}
    const pending=figures.map(figure=>resources.surface(figure).catch(error=>error));
    assert.ok(resources.decodeQueue.length<=2,'decode queue stays bounded');
    const results=await Promise.all(pending);
    assert.ok(results.at(-1).store?.size===1,'the final seek decodes its cel');
    assert.ok(results[8].store?.size===1);
    assert.ok(results.slice(1,8).every(r=>r?.name==='AbortError'),'superseded decodes abort');
    assert.ok(resources.stats.decodes<=3,`decodes ${resources.stats.decodes}`);
  }finally{resources.dispose();}
});

test('a gesture commit releases its pin so the broadcast barrier publishes the last stroke',async()=>{
  const {e,resources}=fixture();try{
    const target=e.prepareDrawingCel({pixelsPerUnit:1,world:{x:32,y:32}}),surface=await resources.surface(target.figure);
    const brush=new DrawingStroke(surface.store,{size:8,pressureSize:false});brush.sample({x:40,y:40});
    // commitStroke ordering: pin and busy stay held across the synchronous emit
    // that mirrors the document into playback; the barrier inside it must see
    // the committed tiles, not the previous published blob.
    surface.pinned=true;resources.busy=true;
    let published,figureIndices;
    const listener=event=>{
      const d=event.detail??{};
      if(d.kind!=='edit'||!d.drawing)return;
      figureIndices=d.figureIndices;
      published=(async()=>{await resources.flush();return e.report.figure_types.find(f=>drawingMetadata(f)?.celId===drawingMetadata(target.figure).celId);})();
    };
    e.addEventListener('change',listener);
    try{e.commitDrawingPixels(target,brush.finish());}finally{resources.busy=false;surface.pinned=false;e.removeEventListener('change',listener);}
    const figure=await published,entry=resources.entry(target.figure);
    assert.ok(figure,'the drawing emit published during the commit broadcast');
    assert.deepEqual(figureIndices,[e.report.figure_types.indexOf(figure)]);
    assert.ok(figure.image_assets[0].styk_tiles,'the last stroke is in the serialized asset');
    assert.equal((await decodeTileBlob(figure.image_assets[0].styk_tiles)).length,entry.store.size);
    assert.equal(drawingMetadata(figure).revision,entry.revision);
    assert.equal(entry.published.revision,entry.revision);
    // A second stroke republishes: the mirror never lags one stroke behind.
    surface.pinned=true;resources.busy=true;published=null;
    e.addEventListener('change',listener);
    const dab=new DrawingStroke(entry.store,{size:8,pressureSize:false});dab.sample({x:20,y:20});
    try{e.commitDrawingPixels(e.drawingTarget(),dab.finish());}finally{resources.busy=false;surface.pinned=false;e.removeEventListener('change',listener);}
    const figure2=await published,d2=drawingMetadata(figure2);
    assert.equal(d2.revision,entry.revision);assert.ok(d2.revision>1);
    assert.equal((await decodeTileBlob(figure2.image_assets[0].styk_tiles)).length,entry.store.size);
  }finally{resources.dispose();}
});
