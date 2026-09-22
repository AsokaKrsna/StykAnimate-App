import test from 'node:test';
import assert from 'node:assert/strict';
import {construction} from '../src/rig-examples-3d.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {Editor} from '../src/editor.mjs';
import {spatialPoint,quatRotate,quatMultiply} from '../src/rig-spatial.mjs';
import {spatialWorldQuaternion,spatialWorldVector,inverseQuaternion} from '../src/ik-spatial.mjs';
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
  assert.ok(Math.hypot(...state(e,upper).p.map((v,i)=>v-knee.p[i]))>5);near(state(e,lower).end.x,ankle.end.x);near(state(e,lower).end.y,ankle.end.y);sameOrientation(state(e,foot).q,pinned?boot.q:quatMultiply(quatMultiply(state(e,lower).q,inverseQuaternion(ankle.q)),boot.q));assert.equal(e.object._stykIK[lower].pinned,pinned);
  e.cancelDrag();assert.deepEqual(e.serialize(),before);
 }
});

test('repeated closed IK drags return the shin to the same orientation without accumulated twist',()=>{
 for(const pinned of [false,true])for(const mirror of [false,true]){
  const{e,upper,lower,foot}=fixture();e.select(1,-1);if(mirror)e.mirrorFigure();
  e.select(1,lower-1);e.setNodeIK({enabled:true,pinned,bendDirection:0});
  const origin=state(e,lower).end,center={x:origin.x+25,y:origin.y+(mirror?45:-45)};
  e.poseIKTarget(center.x+20,center.y);const before=state(e,lower),boot=state(e,foot);
  e.beginDrag('Loop IK target');
  for(let i=1;i<=180;i++){
   const a=i*Math.PI/30;e.poseIKTarget(center.x+20*Math.cos(a),center.y+20*Math.sin(a));
   assert.ok(state(e,upper).q.every(Number.isFinite));
  }
  e.commitDrag();sameOrientation(state(e,lower).q,before.q);sameOrientation(state(e,foot).q,boot.q);
 }
});

test('direct shin rotation releases that limb and carries the ankle and toes without a pose jump',()=>{
 for(const mirror of [false,true]){
  const{e,lower,foot,toe}=fixture();e.select(1,-1);if(mirror)e.mirrorFigure();
  e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});
  const target=state(e,lower).end;e.poseIKTarget(target.x+20,target.y+(mirror?25:-25));
  const shin=state(e,lower),boot=state(e,foot),tip=state(e,toe),pose=e.getSpatialPose(),saved=e.serialize();
  e.setSpatialPose({turn:pose.turn+.6,pitch:pose.pitch+.35});
  assert.equal(e.object._stykIK[lower].pinned,false);
  const delta=quatMultiply(state(e,lower).q,inverseQuaternion(shin.q));
  sameOrientation(state(e,foot).q,quatMultiply(delta,boot.q));sameOrientation(state(e,toe).q,quatMultiply(delta,tip.q));
  e.undo();assert.deepEqual(e.serialize(),saved);
 }
});

test('native angle edits carry the foot, while a no-op spatial edit leaves its pin intact',()=>{
 const{e,lower,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});e.poseIKTarget(220,245);
 const old=e.serialize(),count=e._undo.length,shin=state(e,lower),boot=state(e,foot);
 assert.equal(e.setSpatialPose(e.getSpatialPose()),false);assert.equal(e.object._stykIK[lower].pinned,true);assert.equal(e._undo.length,count);
 e.rotateJoint(.35);assert.equal(e.object._stykIK[lower].pinned,false);
 const delta=quatMultiply(state(e,lower).q,inverseQuaternion(shin.q));sameOrientation(state(e,foot).q,quatMultiply(delta,boot.q));
 e.undo();assert.deepEqual(e.serialize(),old);
});

test('target depth and full knee orbits preserve planted orientation or the free ankle articulation',()=>{
 for(const pinned of [false,true]){
  const{e,lower,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned,bendDirection:0});e.poseIKTarget(215,235);
  const boot=state(e,foot),shin=state(e,lower);e.setSpatialIKTarget({depth:35});near(state(e,lower).p[2],35);near(state(e,lower).end.x,215);near(state(e,lower).end.y,235);
  sameOrientation(state(e,foot).q,pinned?boot.q:quatMultiply(quatMultiply(state(e,lower).q,inverseQuaternion(shin.q)),boot.q));const before=state(e,lower),footBefore=state(e,foot);
  // Separate edits and a single continuous gesture must agree. Neither can
  // repeatedly add the previously displayed swivel to the new value.
  for(const angle of [Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*2])e.setNodeIK({swivel:angle});
  sameOrientation(state(e,lower).q,before.q);sameOrientation(state(e,foot).q,footBefore.q);
  e.beginDrag('Orbit knee');for(let i=0;i<=72;i++)e.setSpatialIKTarget({swivel:i*Math.PI/36});e.commitDrag();
  sameOrientation(state(e,lower).q,before.q);assert.equal(e.object._stykIK[lower].pinned,pinned);
  const saved=e.serialize();e.beginDrag('Depth');e.setSpatialIKTarget({depth:-30});e.cancelDrag();assert.deepEqual(e.serialize(),saved);
 }
});

test('direct joint dragging preserves depth and returns without accumulated twist',()=>{
 for(const mirror of [false,true])for(const scale of [.65,1.4]){
  const{e,body,upper,foot}=fixture();e.select(1,-1);if(mirror)e.mirrorFigure();e.object.scale=scale;e.touch();
  e.select(1,body-1);e.setSpatialPose({turn:.6,pitch:.3});e.select(1,upper-1);e.setSpatialPose({turn:.4,pitch:.2});
  const g=e.geometry.objects.get(0).segments[upper-1],center={...g.start},point={...g.end},before=state(e,upper),boot=state(e,foot),saved=e.serialize();
  const radius=Math.hypot(point.x-center.x,point.y-center.y),angle=Math.atan2(point.y-center.y,point.x-center.x);
  e.beginDrag('Pose knee');
  for(let i=1;i<=60;i++){const a=angle+i*Math.PI/30;e.poseJoint(center.x+radius*Math.cos(a),center.y+radius*Math.sin(a));near(state(e,upper).p[2],before.p[2],1e-4);}
  sameOrientation(state(e,upper).q,before.q);sameOrientation(state(e,foot).q,boot.q);e.cancelDrag();assert.deepEqual(e.serialize(),saved);
 }
});

test('dragging a planted knee steers the existing pole and retains the foot',()=>{
 const{e,upper,lower,foot}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});e.poseIKTarget(215,245);
 const before=e.serialize(),ankle=state(e,lower),boot=state(e,foot),knee=state(e,upper);e.select(1,upper-1);
 e.beginDrag('Pose knee');e.poseJoint(knee.end.x+60,knee.end.y-20);
 assert.equal(e.selectedJoint,upper-1);assert.equal(e.object._stykIK[lower].pinned,true);
 assert.ok(Math.hypot(...state(e,upper).p.map((v,i)=>v-knee.p[i]))>5);
 near(state(e,lower).end.x,ankle.end.x);near(state(e,lower).end.y,ankle.end.y);sameOrientation(state(e,foot).q,boot.q);
 e.cancelDrag();assert.deepEqual(e.serialize(),before);
});


test('whole-figure orientation rigidly carries planted ankles, poles and boots with undo and cancellation',()=>{
 for(const mirror of [false,true])for(const scale of [1.4,.8]){
  const{e,body,upper,lower,foot,toe}=fixture();e.object.scale=scale;
  e.select(1,-1);if(mirror)e.mirrorFigure();
  e.select(1,foot-1);e.setSpatialPose({turn:.3,pitch:.2});
  e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});
  e.rotateIKTarget(.25);const p=state(e,lower).end;e.poseIKTarget(p.x+12,p.y-15*scale);
  const position=id=>{const g=e.geometry.objects.get(0),p=spatialWorldVector(state(e,id).p,e.figure,e.object);return[p[0]*scale+g.root.x,p[1]*scale+g.root.y,p[2]*scale];};
  const ids=[upper,lower,foot,toe],before=ids.map(id=>({p:position(id),q:state(e,id).q})),saved=e.serialize(),base=state(e,body).q,root=e.geometry.objects.get(0).root;
  e.select(1,body-1);e.beginDrag('Orient figure');
  for(const turn of [.4,1.1,-.6]){
   e.setSpatialPose({turn,pitch:.3,bend:.2},{wholeFigure:true});const delta=quatMultiply(state(e,body).q,inverseQuaternion(base));
   ids.forEach((id,i)=>{const expected=quatRotate(delta,[before[i].p[0]-root.x,before[i].p[1]-root.y,before[i].p[2]]),actual=position(id);expected[0]+=root.x;expected[1]+=root.y;actual.forEach((v,j)=>near(v,expected[j],.005));sameOrientation(state(e,id).q,quatMultiply(delta,before[i].q));});
   assert.equal(e.object._stykIK[lower].pinned,true);validateIK(e.object);
  }
  e.cancelDrag();assert.deepEqual(e.serialize(),saved);
  e.setSpatialPose({turn:.8},{wholeFigure:true});const reopened=new Editor({demo:false});reopened.load(e.serialize());sameOrientation(state(reopened,foot).q,state(e,foot).q);
  e.undo();assert.deepEqual(e.serialize(),saved);
 }
});

test('pose drags swing a spatial bone in 3D at constant length; Shift mirrors its depth side',()=>{
 for(const mirror of [false,true]){
  const{e,body,upper,foot}=fixture();e.select(1,-1);if(mirror)e.mirrorFigure();
  e.select(1,body-1);e.setSpatialPose({turn:.3});e.select(1,upper-1);
  const start={...e.geometry.objects.get(0).segments[upper-1].start},saved=e.serialize(),before=state(e,upper),boot=state(e,foot);
  const bone=()=>{const s=e.geometry.objects.get(0).segments[upper-1],f=s.spatialFrame,r=s.seg._stykRig.spatial;return spatialWorldVector(spatialPoint(f,r.tip).map((v,i)=>v-spatialPoint(f,r.origin)[i]),e.figure,e.object).map(v=>v*e.object.scale);};
  const full=Math.hypot(...bone());
  e.beginDrag('Pose thigh');
  // Pulled toward its base the thigh leaves the view plane toward the front.
  const inside={x:start.x+full*.35,y:start.y+full*.3};e.poseJoint(inside.x,inside.y);
  let s=e.geometry.objects.get(0).segments[upper-1];near(s.end.x,inside.x,1e-3);near(s.end.y,inside.y,1e-3);near(Math.hypot(...bone()),full,1e-6);
  const front=bone()[2];assert.ok(Math.abs(front)>full*.5);
  e.poseJoint(inside.x,inside.y,{alternate:true});s=e.geometry.objects.get(0).segments[upper-1];
  near(s.end.x,inside.x,1e-3);near(s.end.y,inside.y,1e-3);near(bone()[2],-front,1e-6);
  // Beyond its reach the bone lies in the view plane and points at the cursor.
  e.poseJoint(start.x-full*3,start.y);near(bone()[2],0,1e-6);near(Math.hypot(...bone()),full,1e-6);
  // Returning to the grab point restores every axis, including twist.
  e.poseJoint(before.end.x,before.end.y);sameOrientation(state(e,upper).q,before.q);sameOrientation(state(e,foot).q,boot.q);
  e.cancelDrag();assert.deepEqual(e.serialize(),saved);
 }
});

test('right-drag twists a spatial bone about its own axis without moving its end',()=>{
 const{e,upper,foot}=fixture();e.select(1,upper-1);e.setSpatialPose({turn:.2,pitch:.3});
 const saved=e.serialize(),before=state(e,upper),boot=state(e,foot);
 e.beginDrag('Twist thigh');e.bendJoint(100,100,{pixel:1});e.bendJoint(220,140,{pixel:1});
 near(state(e,upper).p[0],before.p[0],1e-6);near(state(e,upper).p[1],before.p[1],1e-6);near(state(e,upper).p[2],before.p[2],1e-6);
 const turned=state(e,foot).q;assert.ok(Math.abs(Math.abs(turned.reduce((n,v,i)=>n+v*boot.q[i],0))-1)>1e-3);
 // A quarter turn per 120 pixels; returning restores the pose exactly.
 e.bendJoint(100,60,{pixel:1});sameOrientation(state(e,foot).q,boot.q);
 e.cancelDrag();assert.deepEqual(e.serialize(),saved);
});

test('Shift-drag on a spatial IK target pushes its depth while it stays under the pointer',()=>{
 const{e,lower}=fixture();e.select(1,lower-1);e.setNodeIK({enabled:true,pinned:true,bendDirection:0});e.poseIKTarget(215,245);
 const saved=e.serialize(),screen={...state(e,lower).end},depth=e.object._stykIK[lower].spatialTarget.depth;
 e.beginDrag('Depth');e.poseJoint(screen.x,screen.y,{alternate:true,pixel:1});e.poseJoint(screen.x+30,screen.y+20,{alternate:true,pixel:1});
 assert.ok(e.object._stykIK[lower].spatialTarget.depth>depth+1);near(state(e,lower).end.x,screen.x,1e-3);near(state(e,lower).end.y,screen.y,1e-3);
 e.cancelDrag();assert.deepEqual(e.serialize(),saved);
});

test('anchored drags never jump on grab and short bones use a longer virtual lever',()=>{
 const{e,foot}=fixture();e.select(1,foot-1);
 const saved=e.serialize(),before=state(e,foot),grab={x:before.end.x+4,y:before.end.y-3};
 e.beginDrag('Pose foot');e.poseJoint(grab.x,grab.y,{anchor:grab,pixel:1});sameOrientation(state(e,foot).q,before.q);
 // The foot is ~38 units long; with a 70-unit lever its end moves less than the pointer.
 e.poseJoint(grab.x,grab.y+20,{anchor:grab,pixel:1});const moved=Math.hypot(state(e,foot).end.x-before.end.x,state(e,foot).end.y-before.end.y);
 assert.ok(moved>2&&moved<20,`${moved}`);
 e.poseJoint(grab.x,grab.y,{anchor:grab,pixel:1});sameOrientation(state(e,foot).q,before.q);
 e.cancelDrag();assert.deepEqual(e.serialize(),saved);
});
