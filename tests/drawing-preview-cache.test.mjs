import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingPreviewCache} from '../src/drawing-preview-cache.mjs';
import {TileStore} from '../src/drawing-tiles.mjs';
const rect={x:0,y:0,width:64,height:64};
const idle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
function fixture(){
  const jobs=[],closed=[],worker={request(kind,data){return new Promise(resolve=>jobs.push({kind,data,resolve}));},dispose(){}},cache=new DrawingPreviewCache(worker,{budgetBytes:64*64*4}),entry={id:'preview',store:new TileStore(),stamp:0,pixelStamp:0};
  entry.store.set(0,0,new Uint8ClampedArray([12,34,56,255]));
  const finish=i=>{const bitmap={width:64,height:64,close(){closed.push(i);this.width=this.height=0;}};jobs[i].resolve({bitmap});return bitmap;};
  return{jobs,cache,entry,finish,closed};
}
test('preview discards stale replies, retries current pixels and sends only changed tiles',async()=>{
  const {jobs,cache,entry,finish,closed}=fixture();try{
    assert.equal(cache.scratch(entry,rect),null);assert.equal(jobs[0].data.tiles.length,1);
    entry.store.set(0,0,new Uint8ClampedArray([255,0,0,255]));entry.pixelStamp++;
    finish(0);await idle();assert.deepEqual(closed,[0]);assert.equal(cache.cache.size,0);
    cache.scratch(entry,rect);assert.equal(jobs[1].data.reset,false);assert.equal(new Uint8ClampedArray(jobs[1].data.tiles[0].pixels)[0],255);
    finish(1);await idle();assert.ok(cache.scratch(entry,rect));
    cache.scratch(entry,rect,{level:1});assert.equal(jobs[2].data.tiles.length,0,'a new mip reuses the worker source');finish(2);await idle();
    assert.ok(cache.bytes<=cache.budgetBytes);assert.ok(closed.includes(1),'LRU eviction closes the old bitmap');
  }finally{cache.dispose();}assert.ok(closed.includes(2));
});
test('preview worker failures back off until source pixels change',async()=>{
  let calls=0,errors=0;const cache=new DrawingPreviewCache({request(){calls++;return Promise.reject(Error('worker lost'));},dispose(){}},{onError:()=>errors++}),entry={id:'failed',store:new TileStore(),stamp:0,pixelStamp:0};entry.store.set(0,0,new Uint8ClampedArray([1,2,3,255]));
  try{cache.scratch(entry,rect);await idle();cache.scratch(entry,rect);await idle();assert.equal(calls,1);assert.equal(errors,1);entry.pixelStamp++;cache.scratch(entry,rect);await idle();assert.equal(calls,2);}finally{cache.dispose();}
});
