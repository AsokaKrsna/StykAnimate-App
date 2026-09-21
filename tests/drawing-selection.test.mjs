import test from 'node:test';
import assert from 'node:assert/strict';
import {TileStore} from '../src/drawing-tiles.mjs';
import {lassoMask,applyTileChanges} from '../src/drawing-pixels.mjs';
import {selectionTiles,transformSelectedPixels} from '../src/drawing-selection.mjs';

test('integer selection translation preserves unselected RGBA and allocates no intervening tiles',()=>{
  const store=new TileStore(),tile=store.writable(0,0);tile.pixels.set([200,100,50,255],(10*64+10)*4);tile.pixels.set([127,5,249,1],(10*64+30)*4);
  const mask=lassoMask([{x:8,y:8},{x:14,y:8},{x:14,y:14},{x:8,y:14}]),pixels=store.readRect(mask.x,mask.y,mask.width,mask.height),before=tile.pixels.slice();
  const matrix=[1,0,0,1,640000,0];assert.equal(selectionTiles(store,mask,matrix).length,1);
  const changes=transformSelectedPixels(store,{mask,pixels,matrix});
  assert.deepEqual(store.pixel(30,10),[127,5,249,1]);assert.deepEqual(store.pixel(640010,10),[200,100,50,255]);assert.equal(store.pixel(10,10)[3],0);assert.equal(store.size,2);
  applyTileChanges(store,changes,'before');assert.equal(store.size,1);assert.deepEqual(store.get(0,0).pixels,before);
});

test('deleting selected pixels preserves nearby translucent and transparent RGB',()=>{
  const store=new TileStore(),t=store.writable(0,0);t.pixels.set([90,60,10,127],(10*64+10)*4);t.pixels.set([25,50,75,0],(10*64+30)*4);
  const mask=lassoMask([{x:8,y:8},{x:14,y:8},{x:14,y:14},{x:8,y:14}]);
  transformSelectedPixels(store,{mask,pixels:store.readRect(8,8,6,6),matrix:[1,0,0,1,0,0],remove:true});
  assert.equal(store.pixel(10,10)[3],0);assert.deepEqual(store.pixel(30,10),[25,50,75,0]);
});

test('lasso rejects oversized dense masks before allocating them',()=>{
  assert.throws(()=>lassoMask([{x:0,y:0},{x:1000000,y:0},{x:1000000,y:1000000}]),/16 megapixels/);
});

test('filtered selection seeds neighboring destination tiles before writing its edge',()=>{
  const original=new TileStore();original.set(0,0,new Uint8ClampedArray([200,100,50,255]));original.set(1,0,new Uint8ClampedArray([127,5,249,1]));
  const mask=lassoMask([{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]),matrix=[2,0,0,2,60,0],worker=new TileStore();
  for(const t of selectionTiles(original,mask,matrix))worker.set(t.tx,t.ty,t.pixels);
  const changes=transformSelectedPixels(worker,{mask,pixels:original.readRect(0,0,2,2),matrix});
  applyTileChanges(original,changes,'after');assert.deepEqual(original.pixel(90,30),[127,5,249,1]);assert.ok(original.pixel(64,1)[3]>1);
});
