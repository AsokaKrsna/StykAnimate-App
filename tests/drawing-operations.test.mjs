import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingController} from '../src/drawing-controller.mjs';
import {restoreClipboard} from '../src/shared-clipboard.mjs';
import {DrawingResources} from '../src/drawing-resources.mjs';
import {createDrawingFigure} from '../src/drawing-model.mjs';
import {TILE_BYTES} from '../src/drawing-tiles.mjs';

function fixture(){
  const d=Object.create(DrawingController.prototype),holds=new Map();
  Object.assign(d,{owner:{busy:false,hold:(k,n)=>n?holds.set(k,n):holds.delete(k)},editor:{revision:1},sequence:0,overlay:{hasPointerCapture:()=>false},onStatus:()=>{},onRender:()=>{},finish:()=>{},applySelection:()=>{},holds});
  return d;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('warm history keeps synchronous command behavior and avoids a pixel operation',()=>{
  const d=fixture();d.owner.history={needsLoad:()=>false};d.editor._undo=[{}];d.editor.undo=()=>true;
  assert.equal(d.history('undo'),true);assert.equal(d.operation,undefined);assert.equal(d.owner.busy,false);
});

test('save and command barriers wait for pixel transaction publication',async()=>{
  const d=fixture(),gate=deferred();let published=false,settled=false;
  const work=d.pixelOperation('Paste',async op=>{await gate.promise;op.check();published=true;});
  const wait=d.settle().then(()=>{assert.ok(published);settled=true;});
  await Promise.resolve();assert.equal(settled,false);assert.equal(d.owner.busy,true);
  gate.resolve();await work;await wait;assert.equal(d.operation,null);assert.equal(d.owner.busy,false);
});

test('cancelled pixel operations release work and reject late publication',async()=>{
  const d=fixture(),gate=deferred();let published=false;
  const work=d.pixelOperation('Resample',async op=>{d.owner.hold(op,100);await gate.promise;op.check();published=true;});
  await Promise.resolve();d.cancel();gate.resolve();
  await assert.rejects(work,{name:'AbortError'});assert.equal(published,false);assert.equal(d.operation,null);assert.equal(d.owner.busy,false);assert.equal(d.holds.size,0);
  await d.pixelOperation('Paste',op=>{op.check();published=true;});assert.ok(published);
});

test('a pen gesture queued behind a pixel operation keeps its samples and release',async()=>{
  const d=fixture(),gate=deferred(),event={pointerId:12,pointerType:'pen',clientX:1,clientY:2,pressure:.4};
  const work=d.pixelOperation('Resample',()=>gate.promise);
  await d.down(event);d.move({...event,clientX:5});d.up(event);
  let replay;d.down=async e=>{replay=e;};d.run=fn=>fn();
  gate.resolve();await work;assert.equal(replay.pointerId,12);assert.equal(replay.samples[0].clientX,5);assert.equal(replay.released,true);
});

test('a failed operation discards its queued gesture and releases its reservation',async()=>{
  const d=fixture();let replayed=false;d.resumeQueuedPointer=()=>{replayed=true;};
  await assert.rejects(d.pixelOperation('Paste',()=>{d.loading={queued:true};throw Error('Budget exceeded');}),/Budget/);
  assert.equal(replayed,false);assert.equal(d.loading,null);assert.equal(d.owner.busy,false);
});

test('pixel clipboard validates world coordinates and affine poses before replacing it',async()=>{
  const editor={_drawingPixelClipboard:'previous',_emit:()=>{}},data={width:1,height:1,pixelsPerUnit:1,dataUrl:'data:image/png;base64,AA==',world:{x:1,y:2}},packet={format:'StykAnimate clipboard',version:1,kind:'drawing-pixels',data};
  await assert.rejects(restoreClipboard(editor,{...packet,data:{...data,world:{x:NaN,y:2}}}),/origin/);
  await assert.rejects(restoreClipboard(editor,{...packet,data:{...data,matrix:[0,0,0,0,1,2]}}),/singular/);
  assert.equal(editor._drawingPixelClipboard,'previous');
  await restoreClipboard(editor,{...packet,data:{...data,matrix:[0,-1,1,0,1,2]}});assert.deepEqual(editor._drawingPixelClipboard.matrix,[0,-1,1,0,1,2]);
});

test('a small operation reserves available memory alongside other unpublished cels',async()=>{
  const first=createDrawingFigure(),second=createDrawingFigure(),report={figure_types:[first,second]},worker={dispose:()=>{},request:()=>{throw Error('Pinned cels must not encode');}};
  const owner=new DrawingResources(report,{worker,tileBytes:TILE_BYTES,hardBytes:8*TILE_BYTES}),d=fixture();d.owner=owner;
  try{
    const other=owner.install(first,[{tx:0,ty:0,pixels:new Uint8ClampedArray(TILE_BYTES)},{tx:1,ty:0,pixels:new Uint8ClampedArray(TILE_BYTES)}]);other.pinned=true;
    const surface=owner.install(second,[]);surface.pinned=true;
    await d.pixelOperation('Fill',op=>{op.reserve(surface,owner.hardBudget);assert.equal(op.maxBytes,6*TILE_BYTES);assert.equal(owner.stats.bytes+owner.workingBytes,owner.hardBudget);});
    assert.equal(owner.workingBytes,0);assert.equal(other.store.size,2);
  }finally{owner.dispose();}
});
