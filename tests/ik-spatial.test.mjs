import test from 'node:test';
import assert from 'node:assert/strict';
import {construction} from '../src/rig-examples-3d.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {Editor} from '../src/editor.mjs';
import {spatialPoint,quatRotate} from '../src/rig-spatial.mjs';
import {spatialWorldQuaternion} from '../src/ik-spatial.mjs';
import {validateIK,interpolateIK} from '../src/ik.mjs';
function fixture(){
 const q=construction();q.add(0,0,0,'Figure rotation');
 const bone=(parent,origin,tip,name)=>{const turn=q.add(0,0,0,name+' turn'),pitch=q.add(0,0,0,name+' tilt'),v=tip.map((n,i)=>n-origin[i]);return q.add(parent,Math.hypot(...v),Math.atan2(v[1],v[0]),name,{control:true,rig:{spatial:{parent,origin,tip,turn,pitch}}});};
 const body=bone(0,[0,0,0],[0,0,0],'Body'),upper=bone(body,[0,0,0],[0,90,15],'Thigh'),lower=bone(upper,[0,90,15],[0,170,0],'Shin'),foot=bone(lower,[0,170,0],[0,185,35],'Foot'),toe=bone(foot,[0,185,35],[0,185,50],'Toe');
 const f={figure_type_id:1,segments:q.segments,polyfills:[],image_assets:[],text_assets:[]},e=new Editor({demo:false});e.load({...emptyDocument(),figure_types:[f],keyframes:[createFrame([createObject(f,1,200,100)])]});
 return{e,body,upper,lower,foot,toe};
}
const near=(a,b,t=.003)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function state(e,id){const g=e.geometry.objects.get(0),s=g.segments[id-1];return {q:spatialWorldQuaternion(s.spatialFrame.q,e.figure,e.object),p:spatialPoint(s.spatialFrame,s.seg._stykRig.spatial.tip),end:s.end};}
function sameOrientation(a,b){near(Math.abs(a.reduce((n,v,i)=>n+v*b[i],0)),1,1e-6);}
test('planted feet retain depth and all three orientation axes through hip movement and body turns',()=>{
 for(const mirror of [false,true]){
  const{e,body,lower,foot,toe}=fixture();e.select(1,-1);if(mirror)e.mirrorFigure();
  e.select(1,foot-1);e.setSpatialPose({turn:.4,pitch:-.25,bend:.1});e.select(1,toe-1);e.setSpatialPose({pitch:.2});
  e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0,chainLength:2});
  const ankle=state(e,lower),before=state(e,foot),toeBefore=state(e,toe),saved=e.serialize();
  e.select(1,-1);e.moveSelection(18,20);e.select(1,body-1);e.setSpatialPose({turn:1.4,pitch:.25,bend:.2});
  const next=state(e,foot),target=state(e,lower);near(target.end.x,ankle.end.x);near(target.end.y,ankle.end.y);near(target.p[2],ankle.p[2]);sameOrientation(next.q,before.q);sameOrientation(state(e,toe).q,toeBefore.q);
  e.undo();e.undo();assert.deepEqual(e.serialize(),saved);
 }
});
test('a pinned foot can still be rotated directly; unpinning and repinning do not jump',()=>{
 const{e,lower,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});e.select(1,-1);e.moveSelection(0,20);
 e.select(1,foot-1);const p=e.getSpatialPose();e.setSpatialPose({pitch:p.pitch+.6,turn:p.turn+.7});near(e.getSpatialPose().pitch,p.pitch+.6,1e-6);near(e.getSpatialPose().turn,p.turn+.7,1e-6);
 const before=state(e,foot);e.select(1,lower-1);e.setNodeIK({pinned:false});sameOrientation(state(e,foot).q,before.q);e.setNodeIK({pinned:true});sameOrientation(state(e,foot).q,before.q);
 const copy=new Editor({demo:false});copy.load(e.serialize());copy.select(1,lower-1);sameOrientation(state(copy,foot).q,before.q);
});
test('knee swivel changes the bend plane while keeping foot position and orientation',()=>{
 const{e,lower,upper,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});e.poseIKTarget(215,245);
 const knee=state(e,upper),before=state(e,foot),ankle=state(e,lower);e.setNodeIK({swivel:1.2});assert.ok(Math.hypot(...state(e,upper).p.map((v,i)=>v-knee.p[i]))>10);
 near(state(e,lower).end.x,ankle.end.x);near(state(e,lower).end.y,ankle.end.y);sameOrientation(state(e,foot).q,before.q);
});
test('spatial targets reject invalid orientations and interpolate rotations on the short arc',()=>{
 const{e,lower}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});const a=structuredClone(e.object),b=structuredClone(a),c=b._stykIK[lower];
 c.spatialFollowers[Object.keys(c.spatialFollowers)[0]]=[0,0,1,0];const sample=interpolateIK(a,b,.5);validateIK({_stykIK:sample});
 const q=Object.values(sample[lower].spatialFollowers)[0],v=quatRotate(q,[1,0,0]);near(v[0],0);near(v[1],1);
 a._stykIK[lower].joinedSpatialFollowers={5:{99:[0,0,0,1]}};b._stykIK[lower].joinedSpatialFollowers={5:{99:[0,0,1,0]}};
 const joined=interpolateIK(a,b,.5)[lower].joinedSpatialFollowers[5][99];near(quatRotate(joined,[1,0,0])[1],1);
 c.spatialTarget.depth=Infinity;assert.throws(()=>validateIK(b),/spatial IK/);c.spatialTarget.depth=0;c.spatialFollowers[99]=[0,0,0,2];assert.throws(()=>validateIK(b),/spatial IK/);
});
test('planting both feet is one undoable edit and retains selection',()=>{
 const{e,lower,foot}=fixture();e.figure.segments[foot-1].name='Left foot ankle';e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:false,bendDirection:0});e.select(1,-1);
 const count=e._undo.length,old=e.serialize();assert.equal(e.setSpatialFeetPinned(true),true);assert.equal(e.selectedJoint,-1);assert.equal(e._undo.length,count+1);assert.equal(e.object._stykIK[lower].pinned,true);e.undo();assert.deepEqual(e.serialize(),old);
});
test('dragging a spatial pole changes the knee, retains the foot, and cancels as one gesture',()=>{
 for(const pinned of [false,true]){
  const{e,lower,upper,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned,bendDirection:0});e.poseIKTarget(215,245);
  const before=e.serialize(),pole=e.getSpatialIKPole(),knee=state(e,upper),ankle=state(e,lower),boot=state(e,foot);assert.ok(pole);
  e.beginDrag('Move IK pole');e.setSpatialIKPole(pole.point[0]+80,pole.point[1]-20,pole.point[2]);
  assert.ok(Math.hypot(...state(e,upper).p.map((v,i)=>v-knee.p[i]))>5);near(state(e,lower).end.x,ankle.end.x);near(state(e,lower).end.y,ankle.end.y);sameOrientation(state(e,foot).q,boot.q);assert.equal(e.object._stykIK[lower].pinned,pinned);
  e.cancelDrag();assert.deepEqual(e.serialize(),before);
 }
});
