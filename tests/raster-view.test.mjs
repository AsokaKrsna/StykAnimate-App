import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterBounds,rasterCovers,rasterViewport} from '../src/raster-view.mjs';
import {rasterResolution} from '../src/renderer-geometry.mjs';

test('preview density follows high zoom without a hard 8x ceiling',()=>{
  for(const scale of [1,2.05,8,8.001,16,32,100,200]){
    const density=rasterResolution(scale);
    assert.ok(density>=scale&&density<scale*2**.25);
  }
});

test('viewport coverage includes all inverse corners under rotation and mirroring',()=>{
  for(const mirror of [1,-1])for(const angle of [0,.63]){
    const c=Math.cos(angle)*32,s=Math.sin(angle)*32,m=[c*mirror,s*mirror,-s,c,-71,43];
    const rect=rasterViewport(m,640,480),det=m[0]*m[3]-m[1]*m[2];
    for(const [x,y] of [[0,0],[640,0],[0,480],[640,480]]){
      const wx=(m[3]*(x-m[4])-m[2]*(y-m[5]))/det,wy=(m[0]*(y-m[5])-m[1]*(x-m[4]))/det;
      assert.ok(wx>=rect.x-1e-9&&wx<=rect.x+rect.width+1e-9&&wy>=rect.y-1e-9&&wy<=rect.y+rect.height+1e-9);
    }
  }
  assert.equal(rasterViewport([0,0,0,0,0,0],640,480),null);
});

test('high zoom crops before limiting dimensions and keeps the source pixel grid',()=>{
  const bounds={x:-17.3,y:4.7,width:10000,height:6000},view={x:63.1,y:84.5,width:20,height:15};
  const result=rasterBounds(bounds,view,32,4096,128);
  assert.equal(result.pixelScale,32);
  assert.ok(result.pixelWidth<1100&&result.pixelHeight<950);
  assert.ok(result.fullPixels>1e10);
  assert.equal(result.cropped,true);
  assert.ok(Math.abs((result.x-bounds.x)*32-Math.round((result.x-bounds.x)*32))<1e-9);
  assert.ok(rasterCovers(result,bounds,view));
  assert.ok(rasterCovers(result,bounds,{...view,x:view.x+2}),'small pan stays within retained coverage');
  assert.equal(rasterCovers(result,bounds,{...view,x:view.x+40}),false);
});

test('ordinary rasters preserve their dimensions, density and sampling guards',()=>{
  const bounds={x:10.2,y:-3.1,width:70.4,height:29.3};
  const full=rasterBounds(bounds,null,2);
  assert.deepEqual([full.pixelWidth,full.pixelHeight,full.pixelScale,full.x,full.y],[141,59,2,10.2,-3.1]);
  const crop=rasterBounds(bounds,{x:20,y:0,width:15,height:10},2);
  assert.deepEqual([crop.pixelWidth,crop.pixelHeight,crop.pixelScale],[35,25,2]);
  assert.equal(rasterBounds(bounds,{x:200,y:200,width:1,height:1},32),null);
});

test('dimension limits apply to actual allocations, including margins and rotated coverage',()=>{
  for(const limit of [128,512,4096,8192])for(const resolution of [8,32,256]){
    const bounds={x:-1000,y:-1000,width:10000,height:10000},view={x:0,y:0,width:2400/resolution,height:1800/resolution};
    const result=rasterBounds(bounds,view,resolution,limit,128);
    assert.ok(result.pixelWidth<=limit&&result.pixelHeight<=limit);
    assert.ok(rasterCovers(result,bounds,view));
  }
  const full=rasterBounds({x:0,y:0,width:10000,height:10000},null,128,4096);
  assert.equal(full.pixelWidth,4096);assert.equal(full.pixelHeight,4096);
  const fractional=rasterBounds({x:-1000,y:-750,width:3400,height:2800},{x:0,y:0,width:640,height:480},8,4096);
  assert.ok(fractional.pixelWidth<=4096&&fractional.pixelHeight<=4096,'Outward rounding cannot add a texel beyond the limit.');
});

test('effect sampling halos are retained and included in coverage and dimension admission',()=>{
  const bounds={x:-1000,y:-1000,width:10000,height:10000},visible={x:0,y:0,width:20,height:15};
  const crop=rasterBounds(bounds,visible,32,4096,128,30);
  assert.equal(crop.padding,30);assert.equal(crop.pixelScale,32);
  assert.ok(crop.x<=-30&&crop.y<=-30&&crop.x+crop.width>=50&&crop.y+crop.height>=45);
  assert.ok(rasterCovers(crop,bounds,visible));
  assert.equal(rasterCovers(crop,bounds,{...visible,x:7}),false,'Visible pixels alone do not establish complete filter coverage.');
  const limited=rasterBounds(bounds,visible,100,4096,128,30);
  assert.ok(limited.pixelWidth<=4096&&limited.pixelHeight<=4096);
  assert.ok(rasterCovers(limited,bounds,visible));
});
