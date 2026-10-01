import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrawingFigure} from '../src/drawing-model.mjs';
import {drawingRasterInputs,drawingRasterKey,changedDrawingRaster,sameDrawingRaster} from '../src/drawing-render-dependencies.mjs';
import {DrawingGpu} from '../src/drawing-gpu.mjs';

test('camera drawing dependencies detect publication and resource lifetime changes without geometry changes',()=>{
  const fig=createDrawingFigure(),items=[{fig}],owner={surfaceVersion:1};
  let entry={id:'fixture',stamp:1,store:null,owner};
  const resources={drawing:()=>entry},snapshot=()=>drawingRasterInputs(items,resources);
  const cold=snapshot();assert.equal(sameDrawingRaster(cold,snapshot()),true);
  entry.store={};assert.equal(changedDrawingRaster(cold),true);
  const decoded=snapshot();entry.stamp++;assert.equal(changedDrawingRaster(decoded),true);
  const ready=snapshot();assert.equal(sameDrawingRaster(ready,snapshot()),true);
  assert.equal(drawingRasterKey(ready),'fixture:2:1');
  entry.store={};assert.equal(sameDrawingRaster(ready,snapshot()),false);
  const replaced=snapshot();entry.owner={surfaceVersion:1};assert.equal(sameDrawingRaster(replaced,snapshot()),false);
  const transferred=snapshot();entry={...entry};assert.equal(sameDrawingRaster(transferred,snapshot()),false);
  const retained=snapshot();entry.disposed=true;assert.equal(sameDrawingRaster(retained,snapshot()),false);
  entry=null;assert.equal(sameDrawingRaster(null,snapshot()),true);
  entry={id:'fixture',stamp:2,store:{},owner};assert.equal(sameDrawingRaster(null,snapshot()),false);
});

test('camera GPU revision follows refinement and provisional strokes and stays stable once complete',()=>{
  const key=Object.getOwnPropertyDescriptor(DrawingGpu.prototype,'presentationKey').get;
  const gpu={presentationOwner:1,stats:{uploads:3,reductions:2,strokeDispatches:0,evictions:0},sessions:new Set()};
  const stable=key.call(gpu);assert.equal(key.call(gpu),stable);
  gpu.stats.uploads++;assert.notEqual(key.call(gpu),stable);
  const uploaded=key.call(gpu);gpu.stats.reductions++;assert.notEqual(key.call(gpu),uploaded);
  const ready=key.call(gpu);gpu.sessions.add({});gpu.stats.strokeDispatches++;assert.notEqual(key.call(gpu),ready);
  const painted=key.call(gpu);gpu.sessions.clear();gpu.stats.evictions++;gpu.sessions.add({});assert.notEqual(key.call(gpu),painted);
  assert.equal(key.call(gpu),key.call(gpu));
  gpu.presentationOwner++;assert.notEqual(key.call(gpu),ready);
});
