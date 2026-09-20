import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingSmoother,MAX_SMOOTHING_SAMPLES} from '../src/drawing-smoother.mjs';
import {DrawingStroke} from '../src/drawing-pixels.mjs';
import {TileStore} from '../src/drawing-tiles.mjs';
import {DrawingController} from '../src/drawing-controller.mjs';
import {StrokeEngine} from '../src/drawing-stroke-engine.mjs';
import {ReferenceSmoother} from './helpers/drawing-reference-smoother.mjs';

test('incremental smoothing matches the original centroid and release tail',()=>{
  for(const step of [0,.001,.25,12]){
    const a=new DrawingSmoother(45.6),b=new ReferenceSmoother(45.6);
    const close=(p,q)=>{for(const k of ['x','y','pressure','time'])assert.ok(Math.abs(p[k]-q[k])<1e-7,`${step}: ${k}: ${p[k]} != ${q[k]}`);};
    for(let i=0;i<3000;i++){const p={x:-1000+i*step,y:500+Math.sin(i/37)*step,pressure:.5+.4*Math.sin(i/20),time:100000+i*4};close(a.add(p),b.add(p));assert.equal(a.size,b.size);}
    while(a.size>1){a.shift();b.shift();close(a.value(),b.value());}
  }
});
test('stationary input retains bounded smoothing state',()=>{
  const a=new DrawingSmoother(48);
  for(let i=0;i<100000;i++)a.add({x:23,y:-12,pressure:.7,time:i});
  assert.equal(a.size,MAX_SMOOTHING_SAMPLES);assert.ok(a.points.length<MAX_SMOOTHING_SAMPLES*2);
  assert.deepEqual(a.value(),{x:23,y:-12,pressure:.7,time:100000-(MAX_SMOOTHING_SAMPLES+2)/3});
});
test('optimized smoothing preserves raster output for pressure, soft paint and erase',()=>{
  for(const erase of [false,true]){
    const stores=[new TileStore(),new TileStore()];
    if(erase)for(const s of stores)for(let x=-1;x<4;x++)s.set(x,0,new Uint8ClampedArray([70,100,190,180]));
    const strokes=stores.map(s=>new DrawingStroke(s,{size:12,stabilization:.8,hardness:.4,pressureOpacity:true,erase}));
    strokes[1].smoother=new ReferenceSmoother(.8*48);
    for(let i=0;i<400;i++)for(const s of strokes)s.sample({x:-10+i*.5,y:30+15*Math.sin(i/27),pressure:.2+.8*(i%71)/70,time:i*3});
    assert.deepEqual(strokes[0].finish(),strokes[1].finish());
  }
});
function controller(){
  const c=Object.create(DrawingController.prototype),messages=[];
  const owner={strokeWorker:{post:m=>messages.push(m)},present(){}};
  const s={id:1,pending:[],margin:5,sent:new Set(),before:new Map(),posted:new Map(),seq:0,outstanding:0,owner,surface:{store:new TileStore()}};
  Object.assign(c,{sessions:new Map([[1,s]]),owner,strokeStats:{batches:0,maxQueueDepth:0},onRender(){}});
  return {c,s,messages};
}
test('worker batches seed existing pixels along cross-batch bridges',()=>{
  const {c,s,messages}=controller(),engine=new StrokeEngine();
  for(let x=0;x<8;x++)s.surface.store.set(x,0,new Uint8ClampedArray([10,20,30,255]));
  const expected=s.surface.store.fork(),settings={size:4,color:[200,40,60],opacity:.5,pressureSize:false};
  const reference=new DrawingStroke(expected,settings);engine.begin(1,settings);
  for(const x of [10,230,450]){
    const point={x,y:30,pressure:1,time:x};reference.sample(point);s.pending.push(point);s.outstanding=0;c.flushStroke(s);
    const m=messages.at(-1);engine.samples(1,m.seq,m.samples,m.tiles);
  }
  assert.deepEqual(engine.end(1),reference.finish());
});
test('backpressure posts at most two batches and sends end after all real samples',()=>{
  const {c,s,messages}=controller();
  for(let i=0;i<20;i++){s.pending.push({x:i,y:20});c.flushStroke(s);}
  assert.equal(s.outstanding,2);assert.equal(messages.length,2);assert.equal(s.pending.length,18);
  s.ended=true;c.flushStroke(s);assert.equal(messages.length,2);
  c.strokeMessage({kind:'tiles',stroke:1,seq:1,tiles:[]});
  assert.deepEqual(messages.map(m=>m.kind),['samples','samples','samples','end']);
  assert.equal(messages.filter(m=>m.kind==='samples').flatMap(m=>m.samples).length,20);
  c.strokeMessage({kind:'tiles',stroke:1,seq:2,tiles:[]});
  assert.equal(messages.filter(m=>m.kind==='end').length,1);
  assert.equal(c.strokeStats.maxQueueDepth,2);
});
