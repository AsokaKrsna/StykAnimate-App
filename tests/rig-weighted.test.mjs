import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {rigExampleDocument} from '../src/rig-examples.mjs';
import {rigConstraintPlan,rigIKAllowed,remapRigReferences} from '../src/rig-constraints.mjs';
import {buildGeometryAsync} from '../src/pivot/geometry.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {rigControlChange,rigControlsView} from '../src/rig-controls.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
function fixture(){const e=new Editor({demo:false});e.load(rigExampleDocument('sliding-carriage'));e.select(1,0);return e;}
function check(e,id,origin,anchors){const g=e.geometry.objects.get(0),o=g.joints.get(origin),p=g.joints.get(id);for(const c of ['x','y'])near(p[c],o[c]+anchors.reduce((n,a)=>n+(g.joints.get(a.joint)[c]-o[c])*a.weight,0));}

test('weighted attachments follow projected anchors, signed weights, movement and negative scale',()=>{
 const e=fixture(),anchors=[{joint:1,weight:-.25},{joint:2,weight:1.25}],s=e.addWeightedJoint(0,anchors);
 for(const angle of [0,.8,Math.PI,-Math.PI,0]){e.select(1,1);e.updateSegment({angle_rad:angle});check(e,s.segment_id,0,anchors);}
 e.select(1,-1);e.moveSelection(300,-80);e.object.scale=-2;e._invalidate();check(e,s.segment_id,0,anchors);
 assert.equal(rigIKAllowed(e.figure,s.segment_id-1),false);
});
test('weighted creation and inspector edits are undoable; invalid dependencies cannot change the document',()=>{
 const e=fixture(),before=e.serialize(),s=e.addWeightedJoint(0,[{joint:1,weight:.5}]);
 e.undo();assert.deepEqual(e.serialize(),before);e.redo();e.select(1,e.figure.segments.findIndex(v=>v.segment_id===s.segment_id));
 assert.match(rigControlsView(e,{builder:true}),/Weighted joint/);
 rigControlChange(e,{id:'rig-weighted-weight-0',valueAsNumber:.75});check(e,s.segment_id,0,[{joint:1,weight:.75}]);
 e.undo();check(e,s.segment_id,0,[{joint:1,weight:.5}]);
 const stable=e.serialize();
 for(const weighted of [{origin:999},{anchors:[]},{anchors:[{joint:s.segment_id,weight:1}]},{anchors:[{joint:1,weight:Infinity}]},{anchors:[{joint:1,weight:1},{joint:1,weight:0}]},{anchors:Array.from({length:17},(_,i)=>({joint:i,weight:0}))}]){
  assert.throws(()=>e.setRigBehavior({weighted}));assert.deepEqual(e.serialize(),stable);
 }
 assert.equal(e.poseJoint(20,40),false);assert.equal(e.beginRigDrag(),false);
 e.select(1,0);assert.throws(()=>e.deleteSingleSegment(),/missing|relationship|itself/);assert.deepEqual(e.serialize(),stable);
});
test('in-place weight edits invalidate plans, reference remapping and native round trips retain relationships',async()=>{
 const e=fixture(),s=e.addWeightedJoint(0,[{joint:1,weight:.5},{joint:2,weight:.5}]),plan=rigConstraintPlan(e.figure);
 s._stykRig.weighted.anchors[0].weight=-.2;
 assert.notEqual(rigConstraintPlan(e.figure),plan);e._invalidate();check(e,s.segment_id,0,s._stykRig.weighted.anchors);
 const copy=structuredClone(s);remapRigReferences(copy,new Map([[0,11],[1,12],[2,13]]));
 assert.deepEqual(copy._stykRig.weighted,{origin:11,anchors:[{joint:12,weight:-.2},{joint:13,weight:.5}]});
 for(const kind of ['styk','stkz']){
  const d=(await decodeDocument(await buildContainerV2(e.serialize(),kind),kind)).document;
  const asyncGeometry=await buildGeometryAsync(d,d.keyframes[0]);
  const p=asyncGeometry.objects.get(0).joints.get(s.segment_id),q=e.geometry.objects.get(0).joints.get(s.segment_id);near(p.x,q.x);near(p.y,q.y);
 }
});
