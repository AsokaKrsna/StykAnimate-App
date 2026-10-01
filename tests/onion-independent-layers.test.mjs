import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {OnionSkinCache,drawingOnionSamples} from '../src/onion-skin.mjs';
import {normalizeEditorSettings} from '../src/settings.mjs';
import {emptyDocument,createObject,createFrame} from '../src/demo.mjs';

test('Camera and blank layer keys do not replace neighboring figure poses',()=>{
  const report=emptyDocument();report.keyframes=[100,200,300].map(x=>createFrame([createObject(report.figure_types[0],1,x,100)],10));
  const editor=new Editor({demo:false,layerTimeline:true}).load(report),overlay=editor.createLayer('Overlay');
  editor.sheetSetEasing(['layer-1'],0,20,{interpolation:'constant'});
  for(const tick of [9,11])editor.sheetInsertKey(['camera'],tick);
  editor.sheetInsertKey([overlay.id],12,{blank:true});editor.seek(10);
  const cache=new OnionSkinCache(),settings=normalizeEditorSettings({onionBefore:1,onionAfter:1});
  const roots=opts=>cache.get(editor,opts).flatMap(s=>s.geometry.orderedObjects.map(g=>g.root.x));
  assert.deepEqual(roots(settings),[100,300]);
  assert.deepEqual(roots({...settings,onionRangeBefore:10,onionRangeAfter:10}),[100,300]);
  assert.deepEqual(roots({...settings,onionRangeBefore:1,onionRangeAfter:1}),[]);
});

test('drawing ranges use their frame distance even when global key spacing yields no sample count',()=>{
  const editor={tick:5,layers:[{id:'d',drawing:{version:1},visible:true}],report:{_styk:{layerSheet:{tracks:{d:{end:10,keys:[
    {tick:0,value:{frameId:'a'}},{tick:5,value:{frameId:'b'}},{tick:8,value:{frameId:'c'}}]}}}}}};
  const settings={onionMode:'keyframes',onionStep:2,onionBefore:0,onionAfter:0,onionRangeBefore:5,onionRangeAfter:3};
  assert.deepEqual(drawingOnionSamples(editor,settings).map(s=>s.tick),[0,8]);
  assert.deepEqual(drawingOnionSamples(editor,{...settings,onionRangeBefore:4,onionRangeAfter:2}),[]);
});
