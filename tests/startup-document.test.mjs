import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-3,`${a} != ${b}`);
const named=(editor,name)=>editor.figure.segments.find(s=>s.name===name);
const select=(editor,name)=>editor.select(1,editor.figure.segments.indexOf(named(editor,name)));
function assertHold(e){
  assert.equal(e.totalTicks,10);assert.equal(e.report.keyframes.length,1);
  const sheet=e.report._styk.layerSheet;
  assert.deepEqual(Object.keys(sheet.tracks).sort(),['camera','layer-1','scene']);
  assert.equal(sheet.duration,10);
  for(const track of Object.values(sheet.tracks)){
    assert.equal(track.end,10);assert.equal(track.keys.length,1);
    assert.equal(track.keys[0].tick,0);assert.equal(track.keys[0].interpolation,'constant');
  }
}

test('New creates a clean Blue scene with one ten-frame key on every layer',()=>{
  for(const layerTimeline of [false,true]){
    const e=new Editor({layerTimeline}).newDocument();
    assert.equal(e.name,'Untitled animation');assertHold(e);
    assert.equal(e.frame.objects.length,1);assert.equal(e.report.figure_types.length,1);
    assert.equal(e.figure.name,'Blue');assert.equal(e.dirty,false);assert.equal(e.canUndo,false);
    assert.equal(Object.keys(e.object._stykIK).length,4);
    assert.ok(Object.values(e.object._stykIK).every(c=>c.enabled&&!c.pinned));
    const baseline=Array.from(e.geometry.objects.get(0).spatialMesh.positions);
    for(let tick=0;tick<10;tick++){
      e.seek(tick);assert.equal(e.evaluatedFrame.objects.length,1);
      assert.deepEqual(Array.from(e.geometry.objects.get(0).spatialMesh.positions),baseline);
    }
    assertHold(e);assert.equal(e.dirty,false);
  }
});

test('The default preserves the approved Blue geometry and owns independent data',async()=>{
  const bytes=new Uint8Array(await readFile(new URL('../design/mascot/pivot-style-2026-09-28/figures/02-blue.stkz',import.meta.url)));
  const approved=(await decodeDocument(bytes,'stkz')).document.figure_types[0];
  const a=createStartupDocument(),b=createStartupDocument();
  assert.deepEqual(a.figure_types[0]._styk.spatialMesh,approved._styk.spatialMesh);
  assert.deepEqual(a.figure_types[0].segments,approved.segments);
  assert.equal(a.keyframes[0].objects[0].root_x,480);assert.equal(a.keyframes[0].objects[0].root_y,280);
  a.figure_types[0].segments[0].name='Changed';
  a.figure_types[0]._styk.spatialMesh.positions[0]+=100;
  a.keyframes[0].objects[0]._stykIK[516].pinned=true;
  a._styk.layerSheet.tracks.scene.end=2;
  assert.equal(b.figure_types[0].segments[0].name,approved.segments[0].name);
  assert.deepEqual(b.figure_types[0]._styk.spatialMesh,approved._styk.spatialMesh);
  assert.equal(b.keyframes[0].objects[0]._stykIK[516].pinned,false);
  assert.equal(b._styk.layerSheet.tracks.scene.end,10);
});

test('Blue poses in depth, undoes head turns, and keeps feet planted during pelvis turns',()=>{
  const e=new Editor({demo:false,layerTimeline:true}).newDocument();
  for(const part of ['upper arm','forearm','thigh','lower leg']){
    const a=e.geometry.objects.get(0).joints.get(named(e,'Left '+part).segment_id);
    const b=e.geometry.objects.get(0).joints.get(named(e,'Right '+part).segment_id);
    near(a.y,b.y);near(a.x+b.x,960);
  }
  const before=Array.from(e.geometry.objects.get(0).spatialMesh.positions);
  select(e,'Head');assert.equal(e.setSpatialPose({turn:.4,pitch:.3}),true);
  assert.notDeepEqual(Array.from(e.geometry.objects.get(0).spatialMesh.positions),before);
  assert.equal(e.undo(),true);assert.deepEqual(Array.from(e.geometry.objects.get(0).spatialMesh.positions),before);
  e.select(1);assert.equal(e.setSpatialFeetPinned(true),true);
  const feet=['Left lower leg','Right lower leg'].map(name=>named(e,name).segment_id);
  const positions=feet.map(id=>({...e.geometry.objects.get(0).joints.get(id)}));
  select(e,'Pelvis');assert.equal(e.setSpatialPose({turn:.3,bend:.12}),true);
  for(const [i,id]of feet.entries()){
    const p=e.geometry.objects.get(0).joints.get(id);near(p.x,positions[i].x);near(p.y,positions[i].y);
    assert.equal(e.object._stykIK[id].pinned,true);
  }
});

test('Native saving and reopening preserve Blue and all three ten-frame holds',async()=>{
  const e=new Editor({demo:false,layerTimeline:true}).newDocument();
  const bytes=await buildContainerV2(e.serialize(),'styk');
  const saved=(await decodeDocument(bytes,'styk')).document;
  const reopened=new Editor({demo:false,layerTimeline:true});reopened.load(saved);
  assertHold(reopened);assert.equal(reopened.figure.name,'Blue');
  assert.deepEqual(reopened.object._stykIK,e.object._stykIK);
  assert.deepEqual(reopened.figure._styk.spatialMesh,e.figure._styk.spatialMesh);
  assert.equal(reopened.canUndo,false);assert.equal(reopened.dirty,false);
});

test('New preserves camera and layer clipboards and pastes into the ten-frame scene with undo',()=>{
  const e=new Editor({demo:false,layerTimeline:true}).newDocument();
  e.setCameraValues({x:40});e.copyCamera();e.sheetCopyFrames(['layer-1'],0,9);
  e.newDocument();const before=e.serialize();assertHold(e);
  e.pasteCamera([0]);assert.equal(e.evaluatedFrame.camera.x,40);
  e.undo();assert.deepEqual(e.serialize(),before);
  e.sheetPasteFrames(['layer-1'],10);assert.equal(e.totalTicks,20);
  assert.deepEqual(e.layerFrameKeys('layer-1').map(k=>k.tick),[0,10]);
  e.seek(19);assert.equal(e.evaluatedFrame.objects.length,1);
  e.undo();assert.deepEqual(e.serialize(),before);assertHold(e);
});
