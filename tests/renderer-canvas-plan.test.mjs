import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasCoverageBounds,canvasBoundsOutside,canvasArtworkPlan,canvasLayerBounds} from '../src/renderer-canvas-plan.mjs';
import {rasterCovers} from '../src/raster-view.mjs';
import {createDrawingFigure} from '../src/drawing-model.mjs';

const bounds={x:0,y:0,width:1000,height:800};
test('compatibility coverage remains conservative for square caps and minified edges',()=>{
  const coverage=canvasCoverageBounds([{type:'line',obj:{scale:1},thickness:20,seg:{segment_kind:'squareLine'}}],bounds);
  assert.deepEqual(coverage,{x:-20,y:-20,width:1040,height:840});
  assert.equal(canvasBoundsOutside(coverage,{x:1015,y:0,width:50,height:50}),false);
  assert.equal(canvasBoundsOutside(coverage,{x:1025,y:0,width:50,height:50}),true);
  assert.equal(canvasBoundsOutside(bounds,{x:1010,y:0,width:50,height:50},20),false);
  assert.equal(canvasBoundsOutside(null,{x:2000,y:0,width:50,height:50}),false);
});

test('unknown media, nested clips and depth retain the complete Canvas painter',()=>{
  for(const item of [{type:'image',asset:{width:100,height:80}},{type:'text',asset:{}},{type:'mesh'},
    {type:'poly',poly:{_stykSurface:{depthTest:true}}},{type:'line',_movieclipOwner:{}},{type:'futurePrimitive'}]){
    assert.equal(canvasCoverageBounds([item],bounds),null);
  }
  assert.ok(canvasCoverageBounds([{type:'image',asset:{display_width:100,display_height:80}}],bounds));
  assert.ok(canvasCoverageBounds([{type:'image',fig:createDrawingFigure({celId:'bounded',figureTypeId:1})}],bounds));
  assert.ok(canvasCoverageBounds([{type:'text',asset:{bounds:{width:100,height:80}}}],bounds));
});

test('ordinary zoom crops substantial off-screen artwork on its original grid',()=>{
  const visible={x:650,y:300,width:200,height:150},resolution=1.25;
  const crop=canvasArtworkPlan(bounds,visible,resolution,{safe:true});
  assert.equal(crop.cropped,true);assert.equal(crop.pixelScale,resolution);
  assert.ok(crop.pixelWidth*crop.pixelHeight<crop.fullPixels*.6);
  assert.ok(rasterCovers(crop,bounds,visible));
  assert.equal((crop.x-bounds.x)*resolution%1,0);
  assert.equal((crop.y-bounds.y)*resolution%1,0);
  assert.equal(canvasArtworkPlan(bounds,visible,resolution,{safe:false}),undefined);
  assert.equal(canvasArtworkPlan({x:0,y:0,width:100,height:80},visible,1,{safe:true}),undefined);
  assert.equal(canvasArtworkPlan(bounds,{x:0,y:0,width:950,height:780},1,{safe:true}),undefined);
});

test('gesture layers crop transformed device extents, preserving uncertain and off-screen coverage',()=>{
  assert.deepEqual(canvasLayerBounds([{x:100,y:50,width:80,height:60}],[2,0,0,2,10,20],8000,6000),
    {x:208,y:118,width:164,height:124});
  assert.deepEqual(canvasLayerBounds([{x:100,y:50,width:80,height:60}],[2,0,0,2,10,20],8000,6000,0,true),
    {x:0,y:0,width:372,height:242},'Exact editing keeps cached-image sampling at the destination origin.');
  assert.deepEqual(canvasLayerBounds([{x:100,y:50,width:80,height:60}],[0,2,-2,0,400,0],800,600),
    {x:178,y:198,width:124,height:164});
  assert.deepEqual(canvasLayerBounds([null],[2,0,0,2,10,20],800,600,40),{x:-40,y:-40,width:880,height:680});
  assert.deepEqual(canvasLayerBounds([{x:10000,y:10000,width:10,height:10}],[1,0,0,1,0,0],800,600),{x:0,y:0,width:1,height:1});
  assert.deepEqual(canvasLayerBounds([],[1,0,0,1,0,0],800,600),{x:0,y:0,width:1,height:1});
});
