import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackWorkerEndpoint} from '../src/playback-worker.mjs';
import {PlaybackCache} from '../src/playback.mjs';
import {createDemo} from '../src/demo.mjs';
const task=()=>new Promise(resolve=>setTimeout(resolve,10));

test('foreground interaction suspends queued packets and resumes each exact tick',async()=>{
  const messages=[];let receive;
  receive=createPlaybackWorkerEndpoint(message=>{messages.push(message);if(message.type==='packet'&&message.tick===0)receive({type:'interaction',active:true});});
  receive({type:'load',revision:1,report:createDemo()});receive({type:'interaction',active:true});
  receive({type:'prepare',revision:1,ticks:[0,1,2]});await task();
  assert.equal(messages.filter(m=>m.type==='packet').length,0);
  receive({type:'interaction',active:false});
  for(let i=0;i<100&&!messages.some(m=>m.type==='packet');i++)await task();
  await task();assert.deepEqual(messages.filter(m=>m.type==='packet').map(m=>m.tick),[0]);
  receive({type:'interaction',active:false});
  for(let i=0;i<100&&messages.filter(m=>m.type==='packet').length<3;i++)await task();
  assert.deepEqual(messages.filter(m=>m.type==='packet').map(m=>m.tick),[0,1,2]);
  assert.equal(messages.filter(m=>m.type==='error').length,0);
  receive({type:'invalidate',revision:2});
});
test('document invalidation removes suspended work before resuming',async()=>{
  const messages=[],receive=createPlaybackWorkerEndpoint(m=>messages.push(m));
  receive({type:'load',revision:1,report:createDemo()});receive({type:'interaction',active:true});
  receive({type:'prepare',revision:1,ticks:[0,1]});receive({type:'invalidate',revision:2});
  receive({type:'load',revision:3,report:createDemo()});receive({type:'prepare',revision:3,ticks:[2]});receive({type:'interaction',active:false});
  for(let i=0;i<100&&!messages.some(m=>m.type==='packet');i++)await task();
  assert.deepEqual(messages.filter(m=>m.type==='packet').map(m=>[m.revision,m.tick]),[[3,2]]);
  receive({type:'invalidate',revision:4});
});
test('suspended preparation timers stop and resume without redundant worker messages',async()=>{
  const messages=[],cache=new PlaybackCache({timeoutMs:10000,workerFactory:()=>({postMessage:m=>messages.push(m),addEventListener(){},terminate(){}})});
  cache.report=createDemo();cache.totalTicks=3;
  const request=cache.prepareRange([0]).catch(error=>error);
  await Promise.resolve();await Promise.resolve();assert.ok(cache.pending.get(0).timer);
  cache.setInteractionActive(true);assert.equal(cache.pending.get(0).timer,null);
  cache.setInteractionActive(true);assert.equal(messages.filter(m=>m.type==='interaction').length,1);
  cache.setInteractionActive(false);assert.ok(cache.pending.get(0).timer);
  cache.dispose();assert.equal((await request).name,'AbortError');
});
