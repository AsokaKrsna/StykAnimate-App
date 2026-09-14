import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackWindow,playbackLookaheadSize,playbackStartupWindow} from '../src/playback-window.mjs';

test('expensive startup gets a bounded runway without starving a smaller worker queue',()=>{
  assert.equal(playbackStartupWindow(60,2,8),6);
  assert.equal(playbackStartupWindow(60,20,8),15);
  for(const cores of [1,2,4,8,32])for(const fps of [1,30,60,120,240])for(const cost of [0,10,100])
    assert.ok(playbackStartupWindow(fps,cost,cores)<=playbackLookaheadSize(24,cores));
});

test('non-looping lookahead drains at the exclusive end without requesting the opening',()=>{
  assert.deepEqual(playbackWindow(97,24,{start:10,end:100}),[97,98,99]);
  assert.deepEqual(playbackWindow(100,24,{start:10,end:100}),[]);
  assert.deepEqual(playbackWindow(8,3,{start:10,end:100}),[10,11,12]);
});
test('looping lookahead wraps only within its selected range and never duplicates ticks',()=>{
  assert.deepEqual(playbackWindow(97,6,{start:90,end:100},{loop:true}),[97,98,99,90,91,92]);
  assert.deepEqual(playbackWindow(10,24,{start:10,end:11},{loop:true}),[10]);
  assert.deepEqual(playbackWindow(10,24,{start:10,end:10},{loop:true}),[]);
});
test('editable lookahead preserves nearby reverse seeks and range boundaries',()=>{
  assert.deepEqual(playbackWindow(98,8,{start:10,end:100},{bidirectional:true}),[98,99,97,96]);
  assert.deepEqual(playbackWindow(11,4,{start:10,end:100},{bidirectional:true}),[11,12,13,10]);
});
