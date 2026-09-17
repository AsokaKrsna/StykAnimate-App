import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackCache} from '../src/playback.mjs';
import {previewMemoryPlan} from '../src/playback-budget.mjs';
import {createDemo} from '../src/demo.mjs';

test('pixel packet admission follows cache capacity instead of the vector buffer limit',async()=>{
  const mib=1024*1024;
  for(const maxBytes of [32,128,512].map(n=>n*mib)){
    const cache=new PlaybackCache({maxBytes,workerFactory:()=>({postMessage(){},addEventListener(){},terminate(){}})});
    let admission;
    cache._sendLoad=async(client,message)=>{admission??=message.options;};
    try {
      cache.load(createDemo());await cache._loadPromise;
      assert.ok(admission.maxPacketBytes<maxBytes,'Background upload headroom must remain');
      if(maxBytes>=128*mib)assert.ok(admission.maxPacketBytes>64*mib,'Separate texture allocations must not inherit a storage-buffer cap');
      else assert.ok(admission.maxPacketBytes<32*mib,'Low-memory budgets remain bounded');
    }finally{cache.dispose();}
  }
});

test('raster retention scales with available memory without exceeding its partition',()=>{
  for(const memory of [.5,1,2,4,8,16,undefined]){
    const plan=previewMemoryPlan(memory);
    assert.ok(plan.workerRasters<=128*1024*1024);
    assert.ok(plan.workerRasters<=plan.cpuFrames/4);
    assert.ok(plan.workerVectors<=32*1024*1024);
    assert.ok(plan.workerVectors<=plan.cpuFrames/8);
  }
  assert.equal(previewMemoryPlan(8).workerRasters,128*1024*1024);
});

test('startup buffering respects short ranges, known memory limits, and shared footprints',()=>{
  const cache=new PlaybackCache({maxBytes:100,maxFrames:12,workerFactory:()=>({postMessage(){},addEventListener(){},terminate(){}})});
  try {
    cache.totalTicks=20;cache.cache.set(0,{});cache._recentPacketBytes=60;
    cache._packetFootprints.set(0,{base:60,resources:[]});cache._packetFootprints.set(1,{base:60,resources:[]});
    assert.ok(cache.bufferedAhead(0,12),'Two known non-fitting frames must not deadlock startup');
    cache._packetFootprints.set(0,{base:5,resources:[['shared',60]]});cache._packetFootprints.set(1,{base:5,resources:[['shared',60]]});
    assert.equal(cache.bufferedAhead(0,2),false);cache.cache.set(1,{});assert.ok(cache.bufferedAhead(0,2));
    assert.ok(cache.bufferedAhead(0,12,2),'Short playback ranges need only their own frames');
    assert.equal(cache.bufferedAhead(2,12),false);
  }finally{cache.cache.clear();cache.dispose();}
});
