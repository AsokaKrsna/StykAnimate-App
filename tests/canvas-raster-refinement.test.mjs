import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasRasterRefinement} from '../src/canvas-raster-refinement.mjs';
import {createVfx} from '../src/vfx.mjs';

const bitmap=(width=16,height=8)=>({width,height,closed:0,close(){this.closed++;}});
const item=()=>({type:'line',start:{x:0,y:0},end:{x:8,y:4},thickness:2,color:[.2,.3,.7,1],obj:{unique_id:1},fig:{figure_type_id:1}});
const description=extra=>({signature:{},items:[item()],bytes:512,capture:{width:16,height:8},valid:()=>true,allowance:()=>64*1024,install:()=>true,...extra});
const waitFor=async condition=>{
  const deadline=performance.now()+2000;
  while(!condition()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(condition(),'Expected asynchronous refinement state before the deadline.');
};
class Worker {
  calls=[];captures=[];chunks=[];holdChunks=false;outstanding=0;maximum=0;disposed=0;
  request(kind,payload,{signal}={}){
    this.calls.push({kind,payload,signal});this.maximum=Math.max(this.maximum,++this.outstanding);
    if(kind==='composite-chunk')return (this.holdChunks?new Promise(resolve=>this.chunks.push({signal,resolve:()=>resolve({})})):Promise.resolve({})).finally(()=>this.outstanding--);
    assert.equal(kind,'preview-raster');
    return new Promise((resolve,reject)=>this.captures.push({payload,signal,resolve:bitmap=>resolve({bitmap}),reject})).finally(()=>this.outstanding--);
  }
  // A completed transferred bitmap can still arrive after cancellation.
  dispose(){this.disposed++;}
}

test('covered refinement returns before transfer, deduplicates its batch and publishes one independently owned bitmap',async()=>{
  const worker=new Worker(),published=[],invalidations=[];
  const queue=new CanvasRasterRefinement({worker,onInvalidate:()=>invalidations.push(true)}),key={},job=description({install:bitmap=>{assert.equal(queue.stats.bytes,0);published.push(bitmap);return true;}});
  try{
    assert.equal(queue.request(key,job),true);assert.equal(worker.calls.length,0);assert.equal(queue.pending,true);
    const completion=queue.whenReady();assert.equal(queue.request(key,job),true);assert.equal(queue.whenReady(),completion);
    await waitFor(()=>worker.captures.length===1);
    assert.equal(published.length,0);assert.equal(queue.stats.pending,1);assert.equal(queue.stats.bytes,64*1024);
    const result=bitmap();worker.captures[0].resolve(result);await completion;
    assert.deepEqual(published,[result]);assert.equal(result.closed,0);assert.equal(invalidations.length,1);
    assert.equal(worker.maximum,1);assert.equal(queue.pending,false);
    for(const [key,value] of Object.entries({pending:0,bytes:0,completed:1,cancelled:0,failed:0}))assert.equal(queue.stats[key],value,key);
    queue.dispose();assert.equal(result.closed,0,'The published bitmap belongs to the renderer, not to the queue.');result.close();
  }finally{queue.dispose();}
});

test('superseding a held capture closes its late bitmap and publishes only the latest signature',async()=>{
  const worker=new Worker(),published=[],queue=new CanvasRasterRefinement({worker}),key={};
  try{
    queue.request(key,description({signature:'old',install:bitmap=>{published.push(['old',bitmap]);return true;}}));
    await waitFor(()=>worker.captures.length===1);const old=bitmap();
    queue.request(key,description({signature:'new',install:bitmap=>{published.push(['new',bitmap]);return true;}}));
    assert.equal(worker.captures[0].signal.aborted,true);assert.equal(queue.stats.pending,1);
    worker.captures[0].resolve(old);await waitFor(()=>worker.captures.length===2);
    assert.equal(old.closed,1);assert.equal(published.length,0);const current=bitmap();worker.captures[1].resolve(current);
    await queue.whenReady();assert.deepEqual(published,[['new',current]]);assert.equal(worker.maximum,1);assert.equal(queue.stats.completed,1);
    current.close();
  }finally{queue.dispose();}
});

test('a resource validity change during capture discards the result without reporting a worker failure',async()=>{
  const worker=new Worker(),errors=[],published=[],queue=new CanvasRasterRefinement({worker,onError:error=>errors.push(error)});
  let valid=true;
  try{
    queue.request({},description({valid:()=>valid,install:bitmap=>{published.push(bitmap);return true;}}));
    await waitFor(()=>worker.captures.length===1);valid=false;const obsolete=bitmap();worker.captures[0].resolve(obsolete);
    await queue.whenReady();assert.equal(obsolete.closed,1);assert.equal(published.length,0);assert.equal(errors.length,0);
    assert.equal(queue.stats.failed,0);assert.equal(queue.stats.completed,0);assert.equal(queue.stats.bytes,0);
  }finally{queue.dispose();}
});

test('cancelling queued and running jobs releases ownership and allows a later batch',async()=>{
  const worker=new Worker(),errors=[],queue=new CanvasRasterRefinement({worker,onError:error=>errors.push(error)});
  try{
    queue.request('queued',description());queue.cancel();await queue.whenReady();assert.equal(worker.calls.length,0);assert.equal(queue.stats.cancelled,1);
    queue.request('running',description());await waitFor(()=>worker.captures.length===1);const cancelled=bitmap();queue.cancel();
    assert.equal(worker.captures[0].signal.aborted,true);assert.equal(queue.stats.bytes,0);assert.ok(worker.disposed>=1);
    worker.captures[0].resolve(cancelled);await queue.whenReady();
    assert.equal(cancelled.closed,1);assert.equal(queue.stats.cancelled,2);assert.equal(queue.stats.pending,0);assert.equal(queue.stats.bytes,0);assert.equal(errors.length,0);
    queue.request('after',description());await waitFor(()=>worker.captures.length===2);const current=bitmap();worker.captures[1].resolve(current);await queue.whenReady();
    assert.equal(queue.stats.completed,1);current.close();
  }finally{queue.dispose();}
});

test('disposal rejects new work and closes an obsolete transferred result without invalidating the renderer',async()=>{
  const worker=new Worker(),invalidations=[],queue=new CanvasRasterRefinement({worker,onInvalidate:()=>invalidations.push(true)});
  queue.request({},description());await waitFor(()=>worker.captures.length===1);const completion=queue.whenReady(),obsolete=bitmap();
  queue.dispose();assert.equal(queue.request({},description()),false);assert.equal(worker.captures[0].signal.aborted,true);assert.ok(worker.disposed>=1);
  worker.captures[0].resolve(obsolete);await completion;
  assert.equal(obsolete.closed,1);assert.equal(invalidations.length,0);assert.equal(queue.stats.pending,0);assert.equal(queue.stats.bytes,0);assert.equal(queue.pending,false);
});

test('cancellation at a transfer acknowledgement stops a dense snapshot before capture',async()=>{
  const worker=new Worker(),errors=[],queue=new CanvasRasterRefinement({worker,onError:error=>errors.push(error)});worker.holdChunks=true;
  try{
    queue.request({},description({items:Array.from({length:1000},item),allowance:()=>1024*1024}));
    await waitFor(()=>worker.chunks.length===1);queue.cancel();assert.equal(worker.chunks[0].signal.aborted,true);
    worker.chunks[0].resolve();await queue.whenReady();
    assert.equal(worker.calls.length,1);assert.equal(worker.captures.length,0);assert.equal(queue.stats.completed,0);assert.equal(queue.stats.failed,0);
    assert.equal(queue.stats.bytes,0);assert.equal(queue.stats.pending,0);assert.equal(errors.length,0);
  }finally{queue.dispose();}
});

test('selective cancellation discards one owner while the remaining batch keeps its admission',async()=>{
  const worker=new Worker(),published=[],queue=new CanvasRasterRefinement({worker});
  try{
    queue.request('disabled',description());queue.request('visible',description({install:bitmap=>{published.push(bitmap);return true;}}));
    await waitFor(()=>worker.captures.length===1);queue.cancel('disabled');
    assert.equal(queue.stats.pending,1);assert.equal(queue.stats.bytes,0);assert.equal(worker.captures[0].signal.aborted,true);
    const obsolete=bitmap();worker.captures[0].resolve(obsolete);await waitFor(()=>worker.captures.length===2);
    assert.equal(obsolete.closed,1);const visible=bitmap();worker.captures[1].resolve(visible);await queue.whenReady();
    assert.deepEqual(published,[visible]);assert.equal(queue.stats.completed,1);assert.equal(queue.stats.cancelled,1);assert.equal(worker.maximum,1);visible.close();
  }finally{queue.dispose();}
});

test('immediate painting can release a running reservation and restart its unchanged job safely',async()=>{
  const worker=new Worker(),published=[],queue=new CanvasRasterRefinement({worker});
  try{
    queue.request({},description({install:bitmap=>{published.push(bitmap);return true;}}));await waitFor(()=>worker.captures.length===1);
    assert.ok(queue.stats.bytes>0);queue.releaseWorkingMemory();assert.equal(queue.stats.bytes,0);assert.equal(queue.stats.pending,1);assert.equal(worker.captures[0].signal.aborted,true);assert.ok(worker.disposed>=1);
    const obsolete=bitmap();worker.captures[0].resolve(obsolete);await waitFor(()=>worker.captures.length===2);
    assert.equal(obsolete.closed,1);const restarted=bitmap();worker.captures[1].resolve(restarted);await queue.whenReady();
    assert.deepEqual(published,[restarted]);assert.equal(queue.stats.completed,1);assert.equal(queue.stats.failed,0);assert.equal(queue.stats.pending,0);restarted.close();
  }finally{queue.dispose();}
});

test('one bounded retry recovers a transient worker failure and permanent budget failures bypass retry',async()=>{
  const worker=new Worker(),errors=[],queue=new CanvasRasterRefinement({worker,onError:error=>errors.push(error)});
  try{
    queue.request('transient',description({retries:1}));await waitFor(()=>worker.captures.length===1);worker.captures[0].reject(Error('Transient worker failure'));
    await waitFor(()=>worker.captures.length===2);const recovered=bitmap();worker.captures[1].resolve(recovered);await queue.whenReady();
    assert.equal(queue.stats.completed,1);assert.equal(queue.stats.failed,0);assert.equal(errors.length,0);assert.ok(worker.disposed>=1);recovered.close();
    queue.request('budget',description({retries:1}));await waitFor(()=>worker.captures.length===3);worker.captures[2].reject(Object.assign(Error('Bounded capture rejected'),{code:'preview_raster_budget'}));await queue.whenReady();
    assert.equal(worker.captures.length,3);assert.equal(queue.stats.failed,1);assert.equal(errors.length,1);assert.equal(queue.stats.bytes,0);
    queue.request('exhausted',description({retries:1}));await waitFor(()=>worker.captures.length===4);worker.captures[3].reject(Error('Persistent worker failure'));
    await waitFor(()=>worker.captures.length===5);worker.captures[4].reject(Error('Persistent worker failure'));await queue.whenReady();
    assert.equal(worker.captures.length,5);assert.equal(queue.stats.failed,2);assert.equal(errors.length,2);assert.equal(queue.stats.pending,0);assert.equal(queue.stats.bytes,0);
  }finally{queue.dispose();}
});

test('job admission is bounded and replacement does not exceed the serial worker limit',async()=>{
  const worker=new Worker(),queue=new CanvasRasterRefinement({worker,maxJobs:2}),published=[];
  try{
    assert.equal(queue.request('a',description({signature:1})),true);assert.equal(queue.request('b',description()),true);
    assert.equal(queue.request('overflow',description()),false);assert.equal(queue.stats.pending,2);
    assert.equal(queue.request('a',description({signature:2,install:bitmap=>{published.push(bitmap);return true;}})),true);assert.equal(queue.stats.pending,2);
    await waitFor(()=>worker.captures.length===1);const a=bitmap();worker.captures[0].resolve(a);
    await waitFor(()=>worker.captures.length===2);const b=bitmap();worker.captures[1].resolve(b);await queue.whenReady();
    assert.deepEqual(published,[a]);assert.equal(queue.stats.completed,2);assert.equal(worker.maximum,1);assert.equal(queue.stats.bytes,0);
    a.close();b.close();
  }finally{queue.dispose();}
});

test('insufficient working allowance fails before transfer and protects the displayed artwork owner',async()=>{
  const worker=new Worker(),errors=[],failed=[],queue=new CanvasRasterRefinement({worker,onError:error=>errors.push(error)}),displayed=bitmap();
  try{
    queue.request({},description({allowance:()=>511,install:()=>{displayed.close();return true;},failed:error=>failed.push(error)}));await queue.whenReady();
    assert.equal(worker.calls.length,0);assert.equal(displayed.closed,0);assert.equal(errors.length,1);assert.equal(failed.length,1);assert.equal(errors[0],failed[0]);
    assert.ok(errors[0] instanceof RangeError);assert.equal(queue.stats.failed,1);assert.equal(queue.stats.pending,0);assert.equal(queue.stats.bytes,0);
  }finally{queue.dispose();displayed.close();}
});

test('failed captures, invalid dimensions and refused publication close incoming ownership and can recover',async()=>{
  let malformed;
  const worker=new Worker(),errors=[],queue=new CanvasRasterRefinement({worker,onError:error=>{if(malformed)assert.equal(malformed.closed,1);errors.push(error);}});
  try{
    queue.request('failure',description());await waitFor(()=>worker.captures.length===1);worker.captures[0].reject(Error('Worker capture failed'));await queue.whenReady();
    queue.request('dimensions',description());await waitFor(()=>worker.captures.length===2);malformed=bitmap(8,8);worker.captures[1].resolve(malformed);await queue.whenReady();
    assert.equal(malformed.closed,1);assert.equal(errors.length,2);assert.equal(queue.stats.failed,2);
    queue.request('refused',description({install:()=>false}));await waitFor(()=>worker.captures.length===3);const refused=bitmap();worker.captures[2].resolve(refused);await queue.whenReady();
    assert.equal(refused.closed,1);assert.equal(queue.stats.completed,0);assert.equal(queue.stats.failed,2);
    queue.request('recovered',description());await waitFor(()=>worker.captures.length===4);const current=bitmap();worker.captures[3].resolve(current);await queue.whenReady();
    assert.equal(current.closed,0);assert.equal(queue.stats.completed,1);assert.equal(queue.stats.bytes,0);current.close();
  }finally{queue.dispose();}
});

test('publication releases queue capacity before synchronous invalidation requests the next owner',async()=>{
  const worker=new Worker(),published=[];let accepted;
  const queue=new CanvasRasterRefinement({worker,maxJobs:1,onInvalidate:()=>{
    if(published.length===1)accepted=queue.request('next',description({install:bitmap=>{published.push(bitmap);return true;}}));
  }});
  try{
    queue.request('first',description({install:bitmap=>{published.push(bitmap);return true;}}));
    await waitFor(()=>worker.captures.length===1);worker.captures[0].resolve(bitmap());
    await waitFor(()=>worker.captures.length===2);assert.equal(accepted,true);assert.equal(queue.stats.pending,1);
    worker.captures[1].resolve(bitmap());await queue.whenReady();
    assert.equal(queue.stats.completed,2);assert.equal(queue.stats.pending,0);assert.equal(worker.maximum,1);
  }finally{queue.dispose();for(const result of published)result.close();}
});

test('native effects retain the warm worker after capture publishes its independently owned bitmap',async()=>{
  const worker=new Worker(),queue=new CanvasRasterRefinement({worker}),effect=createVfx('shadow','refinement-test'),drawable=item();
  drawable.obj._stykVfx={figure:[effect]};
  try{
    queue.request({},description({items:[drawable],install:()=>{assert.equal(worker.disposed,0);assert.equal(queue.stats.bytes,0);return true;}}));await waitFor(()=>worker.captures.length===1);const result=bitmap();worker.captures[0].resolve(result);await queue.whenReady();
    assert.equal(worker.disposed,0);assert.equal(result.closed,0);assert.equal(queue.stats.completed,1);result.close();
  }finally{queue.dispose();}
});
