import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackUploadWarmup} from '../src/playback-upload.mjs';

function fixture(capacity=3) {
  const resident=new Set(),submitted=[],fences=[];
  const renderer={preparedFrames:{canWarm:()=>resident.size<capacity},
    device:{queue:{onSubmittedWorkDone:()=>new Promise(resolve=>fences.push(resolve))}},
    hasPreparedFrame:key=>resident.has(key),backgroundsReady:()=>true,
    prepareFrame:packet=>{resident.add(packet.key);submitted.push(packet.key);}};
  return {renderer,resident,submitted,fences,packets:[0,1,2].map(key=>({key:String(key),frame:{}}))};
}
test('startup uploads one packet per turn then waits for GPU completion',async()=>{
  const f=fixture();let ready=0;const warmup=new PlaybackUploadWarmup(()=>ready++),options={report:{}};
  for(let i=0;i<3;i++){assert.equal(warmup.step(f.renderer,f.packets,options),false);assert.equal(f.submitted.length,i+1);}
  assert.equal(warmup.step(f.renderer,f.packets,options),false);assert.equal(f.fences.length,1);
  assert.equal(warmup.step(f.renderer,f.packets,options),false);assert.equal(f.fences.length,1,'one queue fence');
  f.fences[0]();await Promise.resolve();assert.equal(ready,1);assert.equal(warmup.step(f.renderer,f.packets,options),true);
});
test('limited residency, pending backgrounds and cancellation cannot evict or deadlock startup',async()=>{
  const f=fixture(1),warmup=new PlaybackUploadWarmup(),options={report:{}};
  f.renderer.backgroundsReady=()=>false;assert.equal(warmup.step(f.renderer,f.packets,options),false);assert.equal(f.submitted.length,0);
  f.renderer.backgroundsReady=()=>true;warmup.step(f.renderer,f.packets,options);warmup.step(f.renderer,f.packets,options);
  assert.deepEqual(f.submitted,['0']);f.fences[0]();await Promise.resolve();assert.equal(warmup.step(f.renderer,f.packets,options),true);
  warmup.reset();assert.equal(warmup.step(f.renderer,f.packets,options),false);
  warmup.reset();f.fences[1]();await Promise.resolve();assert.equal(warmup.fence,null,'obsolete completion cannot restart playback');
  assert.equal(warmup.step({},f.packets,options),true,'software playback keeps its established path');
});
