import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraMonitorVisible,drawCameraMonitor} from '../src/camera-monitor.mjs';

test('collapsed camera monitors do not evaluate or rasterize a scene',()=>{
  const canvas={clientWidth:320,clientHeight:180,checkVisibility:()=>false,getContext(){throw Error('Hidden monitor rendered');}};
  assert.equal(cameraMonitorVisible(canvas),false);
  assert.equal(drawCameraMonitor(canvas,{report:{},frame:{}}),false);
  assert.equal(cameraMonitorVisible({...canvas,checkVisibility:()=>true}),true);
  assert.equal(cameraMonitorVisible({clientWidth:0,clientHeight:180}),false);
});
