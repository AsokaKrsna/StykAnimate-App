import {editorSpatialShapeMethods} from './editor-spatial-shape.mjs';
import {unprojectSpatial,unprojectJoint,projectSpatial,projection} from './spatial-projection.mjs';
import {geometryPlans} from './pivot/geometry-pose.mjs';
import {animationRotation} from './animation-origin.mjs';
import {rigConstraintPlan} from './rig-constraints.mjs';
import {spatialBone,spatialSkin,spatialMotionValue,quatMultiply,quatRotate,spatialPoint,spatialQuaternion,quaternionPose,betweenVectors} from './rig-spatial.mjs';
import {inverseQuaternion,spatialWorldQuaternion,spatialWorldVector,spatialPoleHandle,captureSpatialIK} from './ik-spatial.mjs';
import {ikChain,ikLayout,ikFollowerIndices,solveObjectIK} from './ik.mjs';
import {poseChoiceGroups} from './rig-pose-choices.mjs';

const plans=e=>geometryPlans(e.geometry.objects.get(e.selectedSlot));
const layout=e=>plans(e)?.definition??ikLayout(e.figure);
const rigPlan=e=>plans(e)?.plan??rigConstraintPlan(e.figure);
export const editorSpatialMethods={
 ...editorSpatialShapeMethods,
 setPoseChoice(name,id){
  const group=poseChoiceGroups(this.figure,this.object).find(g=>g.name===name);if(!group)return false;
  if(id!==0&&!group.choices.some(c=>c.id===id))throw new Error('Choose an available rig pose.');
  if(group.value===id)return false;
  return this._objectEdit('Change '+name,o=>{
   const lengths=o.len_flag?o.lengths.slice():this.figure.segments.map(s=>s.length);
   for(const c of group.choices)lengths[c.index]=c.id===id?c.shown:c.hidden;
   o.lengths=lengths;o.len_flag=1;delete o.runtime_segments;
  },{posed:true});
 },
 _releaseSpatialChain(object,index=this.selectedJoint){
  // Direct FK manipulation takes ownership of this limb. The object edit has
  // already baked its displayed IK pose; release only the chain being rotated.
  for(const[id,c]of Object.entries(object._stykIK??{}))if(c.enabled&&c.pinned&&c.spatialTarget&&ikChain(this.figure,Number(id),c.chainLength,layout(this)).includes(index))
   object._stykIK={...object._stykIK,[id]:{...c,pinned:false}};
 },
 getSpatialIKPole(){
  const f=this.figure,o=this.object,s=f?.segments[this.selectedJoint],c=o?._stykIK?.[s?.segment_id];
  if(!c?.enabled||!c.spatialTarget||c.bendDirection!==0)return null;
  const pole=spatialPoleHandle(f,o,this.geometry.objects.get(this.selectedSlot),ikChain(f,s.segment_id,c.chainLength,layout(this)),c.spatialTarget);
  return pole?{...pole,handle:s.segment_id}:null;
 },
 setSpatialIKPole(x,y,depth){
  const pole=this.getSpatialIKPole();if(!pole)return false;
  if(![x,y,depth??pole.point[2]].every(Number.isFinite))throw new Error('Choose a finite IK pole position.');
  const g=this.geometry.objects.get(this.selectedSlot),p=unprojectSpatial({x,y},depth??pole.point[2],this.object,g.root);
  const v=[p.x-pole.center[0],p.y-pole.center[1],(depth??pole.point[2])-pole.center[2]],n=Math.hypot(...v);if(n<1e-6)return false;
  return this.setSpatialIKTarget({pole:v.map(x=>x/n),swivel:0});
 },
 setSpatialIKTarget(patch){
  const f=this.figure,id=f?.segments[this.selectedJoint]?.segment_id,c=this.object?._stykIK?.[id];
  if(!c?.enabled||!c.spatialTarget||c.bendDirection!==0)return false;
  for(const[k,v]of Object.entries(patch)){
   if(k==='pole'){if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||Math.abs(Math.hypot(...v)-1)>1e-5)throw new Error('Choose a unit IK pole direction.');}
   else if(!['depth','swivel'].includes(k)||!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('Choose a finite spatial IK adjustment.');
  }
  const g=this.geometry.objects.get(this.selectedSlot);
  return this._objectEdit(patch.pole?'Move IK pole':'Adjust spatial IK target',o=>{
   let capture;
   if(!c.pinned){
    const key=`${o.unique_id}:${id}`;this._drag.spatialIKCapture??=new Map();
    if(!this._drag.spatialIKCapture.has(key))this._drag.spatialIKCapture.set(key,captureSpatialIK(f,o,g,ikChain(f,id,c.chainLength,layout(this)),ikFollowerIndices(f,id,layout(this)),c.target.rotation,c.spatialTarget.swivel));
    capture=this._drag.spatialIKCapture.get(key);
   }
   const next={...c,...capture,target:{...c.target,...(!c.pinned?unprojectJoint(g.joints.get(id)):{})},spatialTarget:{...(capture?.spatialTarget??c.spatialTarget),...patch}};
   if(patch.depth!==undefined){
    const screen=c.pinned?projectSpatial([c.target.x,c.target.y,c.spatialTarget.depth],projection(o,g.root)):g.joints.get(id);
    Object.assign(next.target,unprojectSpatial(screen,patch.depth,o,g.root));
   }
   if(!c.pinned){
    const solved=solveObjectIK(f,o,g.root,layout(this),{[id]:{...next,pinned:true}},{includePoints:false,rigPlan:rigPlan(this),followTargetOrientation:false});o.angles=solved.angles;
    if(solved.lengths){o.lengths=solved.lengths;o.len_flag=1;}
   }
   o._stykIK={...o._stykIK,[id]:next};delete o.runtime_segments;
  },{posed:true});
 },
 setSpatialFeetPinned(pinned){
  const f=this.figure,o=this.object;if(!f||!o)return false;
  const targets=f.segments.flatMap((s,i)=>o._stykIK?.[s.segment_id]?.enabled&&f.segments.some(child=>spatialBone(child)&&child._stykRig.spatial.parent===s.segment_id&&/foot|ankle/i.test(child.name??''))?[i]:[]);
  if(!targets.length)return false;
  const selected=this.selectedJoint;if(!this.beginDrag(pinned?'Plant feet':'Release feet'))return false;
  try{for(const i of targets){this.selectedJoint=i;this.setNodeIK({pinned});}this.selectedJoint=selected;this.commitDrag();return true;}
  catch(error){this.selectedJoint=selected;this.cancelDrag();throw error;}
 },
 getSpatialPose(index=this.selectedJoint){
  const f=this.figure,o=this.object,s=f?.segments[index];if(!o||!spatialBone(s))return null;
  const r=s._stykRig.spatial,delta=animationRotation(f,o),find=id=>{const i=f.segments.findIndex(s=>s.segment_id===id);return i<0?undefined:i;},parent=find(r.parent),turn=find(r.turn),pitch=find(r.pitch);
  const angles=this.geometry.objects.get(this.selectedSlot)?.solvedAngles??o.angles;
  const sign=o.image_text_flags?-1:1,parentAngle=parent===undefined?0:(angles[parent]-delta)*sign-f.segments[parent].angle_rad;
  return{bend:(angles[index]-delta)*sign-s.angle_rad-parentAngle,turn:(angles[turn]-delta)*sign-f.segments[turn].angle_rad,pitch:(angles[pitch]-delta)*sign-f.segments[pitch].angle_rad};
 },
 setSpatialPose(patch,{wholeFigure=false}={}){
  const before=this.getSpatialPose();if(!before)return false;
  for(const[k,v]of Object.entries(patch))if(!['bend','turn','pitch'].includes(k)||!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('Choose a finite joint rotation.');
  // A hinge accepts only its own rotation; a slide does not rotate.
  const motion=this.getSpatialMotion();if(motion)return motion.type==='hinge'&&patch.bend!==undefined?this.setSpatialMotion(patch.bend):false;
  if(Object.entries(patch).every(([k,v])=>Math.abs(v-before[k])<1e-12))return false;
  const f=this.figure,r=f.segments[this.selectedJoint]._stykRig.spatial,ids=rigPlan(this).ids;
  const frame=this.geometry.objects.get(this.selectedSlot).segments[this.selectedJoint].spatialFrame;
  const parent=quatMultiply(frame.q,inverseQuaternion(spatialQuaternion(before.bend,before.turn,before.pitch))),next={...before,...patch};
  const world=spatialWorldQuaternion(quatMultiply(parent,spatialQuaternion(next.bend,next.turn,next.pitch)),f,this.object),handle=f.segments[this.selectedJoint].segment_id;
  if(wholeFigure&&r.parent)throw new Error('Select the root articulation to rotate the whole figure.');
  const controllers=wholeFigure?this.object._stykIK:null;
  const delta=wholeFigure?quatMultiply(world,inverseQuaternion(spatialWorldQuaternion(frame.q,f,this.object))):null;
  const root=this.geometry.objects.get(this.selectedSlot).root;
  const center=wholeFigure?spatialWorldVector(spatialPoint(frame,r.origin),f,this.object).map((v,i)=>v*this.object.scale+(i===0?root.x:i===1?root.y:0)):null;
  return this._objectEdit('Rotate articulated joint',o=>{
   this._releaseSpatialChain(o);
   if(patch.bend!==undefined)this._rotateJoint((patch.bend-before.bend)*(o.image_text_flags?-1:1));
   for(const key of ['turn','pitch'])if(patch[key]!==undefined)o.angles[ids.get(r[key])]+=(patch[key]-before[key])*(o.image_text_flags?-1:1);
   for(const [id,c]of Object.entries(o._stykIK??{}))if(c.enabled&&c.pinned&&c.spatialFollowers?.[handle])o._stykIK={...o._stykIK,[id]:{...c,spatialFollowers:{...c.spatialFollowers,[handle]:quatMultiply(spatialQuaternion(-c.target.rotation,0,0),world)}}};
   // Figure orientation moves the existing targets and their bend planes as
   // one rigid transform. Local torso posing still leaves planted feet alone.
   if(controllers)o._stykIK=Object.fromEntries(Object.entries(controllers).map(([id,c])=>{
    if(!c.spatialTarget)return[id,c];
    const p=quatRotate(delta,[c.target.x-center[0],c.target.y-center[1],c.spatialTarget.depth-center[2]]);
    const rotate=q=>quatMultiply(spatialQuaternion(-c.target.rotation,0,0),quatMultiply(delta,quatMultiply(spatialQuaternion(c.target.rotation,0,0),q)));
    return[id,{...c,target:{...c.target,x:center[0]+p[0],y:center[1]+p[1]},
     spatialTarget:{...c.spatialTarget,depth:center[2]+p[2],pole:quatRotate(delta,c.spatialTarget.pole)},
     ...(c.spatialFollowers?{spatialFollowers:Object.fromEntries(Object.entries(c.spatialFollowers).map(([id,q])=>[id,rotate(q)]))}:{})}];
   }));
  },{posed:true});
 },
 resetSpatialPose(all=false){
  if(!all)return this.getSpatialMotion()?this.setSpatialMotion(0):this.setSpatialPose({bend:0,turn:0,pitch:0});
  const f=this.figure,o=this.object;if(!f||!o)return false;
  return this._objectEdit('Reset articulated rig',o=>{
   const delta=animationRotation(f,o),ids=rigPlan(this).ids;
   for(const s of f.segments)if(spatialBone(s))for(const id of [s.segment_id,s._stykRig.spatial.turn,s._stykRig.spatial.pitch]){const i=ids.get(id);o.angles[i]=f.segments[i].angle_rad*(o.image_text_flags?-1:1)+delta;}
   // Slides return to their rest position (or the nearest end of their range).
   const slides=f.segments.flatMap((s,i)=>s._stykRig?.spatial?.motion?.type==='slide'?[i]:[]);
   if(slides.length){o.lengths=o.len_flag?o.lengths.slice():f.segments.map(s=>s.length);o.len_flag=1;
    for(const i of slides){const r=f.segments[i]._stykRig.spatial,rest=Math.hypot(...r.tip.map((n,k)=>n-r.origin[k]));o.lengths[i]=rest+Math.min(r.motion.max,Math.max(r.motion.min,0));}}
   // Targets must release when the animator explicitly restores the rest pose.
   if(o._stykIK)o._stykIK=Object.fromEntries(Object.entries(o._stykIK).map(([id,c])=>[id,{...c,pinned:false}]));
  },{posed:true});
 },
 /** Gesture reference for direct spatial posing. Every sample is solved from
  * this fixed start, so closed drags return exactly and twist cannot drift. */
 _spatialGesture(kind){
  const f=this.figure,o=this.object,i=this.selectedJoint,key=`${kind}:${o.unique_id}:${i}`;
  if(this._drag)this._drag.spatialGesture??=new Map();
  let gesture=this._drag?.spatialGesture.get(key);
  if(gesture)return gesture;
  const g=this.geometry.objects.get(this.selectedSlot),shape=g.segments[i],frame=shape.spatialFrame,r=f.segments[i]._stykRig.spatial;
  const world=p=>{const v=spatialWorldVector(p,f,o).map(n=>n*o.scale);return[v[0]+g.root.x,v[1]+g.root.y,v[2]];};
  const start=unprojectJoint(shape.start),origin=[start.x,start.y,world(spatialPoint(frame,r.origin))[2]],tip=world(spatialPoint(frame,r.tip)),vector=tip.map((v,k)=>v-origin[k]),length=Math.hypot(...vector);
  const before=this.getSpatialPose(),local=spatialQuaternion(before.bend,before.turn,before.pitch);
  // Limbs lying in the view plane leave toward the character's front.
  let root=shape;while(root.seg._stykRig?.spatial?.parent){const parent=g.segments[rigPlan(this).ids.get(root.seg._stykRig.spatial.parent)];if(!parent?.spatialFrame)break;root=parent;}
  const front=quatRotate(spatialWorldQuaternion(root.spatialFrame.q,f,o),[0,0,1])[2];
  const depth=length>1e-9?vector[2]/length:0;
  gesture={origin,tip,length,direction:length>1e-9?vector.map(v=>v/length):[1,0,0],side:Math.abs(depth)>.04?Math.sign(depth):front<-.2?-1:1,
   world:spatialWorldQuaternion(frame.q,f,o),parent:quatMultiply(frame.q,inverseQuaternion(local)),start:null};
  this._drag?.spatialGesture.set(key,gesture);
  return gesture;
 },
 /** Write a world orientation for the selected bone into its native channels. */
 _setSpatialWorldOrientation(world,gesture,label,edit){
  const f=this.figure,o=this.object,i=this.selectedJoint,r=f.segments[i]._stykRig.spatial,before=this.getSpatialPose(),ids=rigPlan(this).ids;
  const pose=quaternionPose(quatMultiply(inverseQuaternion(gesture.parent),spatialWorldQuaternion(world,f,o,true)),before);
  return this._objectEdit(label,target=>{
   this._releaseSpatialChain(target);
   const sign=target.image_text_flags?-1:1;this._rotateJoint((pose.bend-before.bend)*sign);
   for(const key of ['turn','pitch'])target.angles[ids.get(r[key])]+=(pose[key]-before[key])*sign;
   edit?.(target);
  },{posed:true});
 },
 /** Right-drag: twist the selected part around its own axis (turn a head,
  * twist a torso or forearm). Horizontal pointer travel sets the angle. */
 twistSpatialJoint(x,y,{pixel=1}={}){
  const f=this.figure,o=this.object,s=f?.segments[this.selectedJoint];if(!o||!spatialBone(s)||!this._drag||s._stykRig.spatial.motion)return false;
  if(![x,y,pixel].every(Number.isFinite)||pixel<=0)return false;
  const gesture=this._spatialGesture('twist');gesture.start??={x,y};
  if(gesture.length<1e-6)return false;
  // 120 screen pixels turn a quarter; the axis is the bone in world space.
  const angle=(x-gesture.start.x)/pixel/120*Math.PI/2*(o.image_text_flags?-1:1),d=gesture.direction,h=Math.sin(angle/2);
  return this._setSpatialWorldOrientation(quatMultiply([d[0]*h,d[1]*h,d[2]*h,Math.cos(angle/2)],gesture.world),gesture,'Twist articulated joint');
 },
 poseSpatialJoint(x,y,{stretch=false,flip=false,planar=false,pixel=0,anchor=null}={}){
  const f=this.figure,o=this.object,i=this.selectedJoint,s=f?.segments[i];if(!o||!spatialBone(s))return false;
  if(![x,y].every(Number.isFinite))return false;
  if(s._stykRig.spatial.motion)return this._moveMechanicalJoint(x,y,anchor);
  // A planted knee/elbow steers its existing bend plane directly. Its end
  // target stays planted; no separate canvas pole is needed.
  if(!stretch)for(const[id,c]of Object.entries(o._stykIK??{})){
   if(!c.enabled||!c.pinned||!c.spatialTarget||c.bendDirection!==0)continue;
   const chain=ikChain(f,Number(id),c.chainLength,layout(this));if(chain.length!==2||chain[0]!==i)continue;
   try{this.selectedJoint=rigPlan(this).ids.get(Number(id));const pole=this.getSpatialIKPole();return pole?this.setSpatialIKPole(x,y,pole.knee[2]):false;}
   finally{this.selectedJoint=i;}
  }
  if(!stretch&&!planar)return this._arcSpatialJoint(x,y,flip,pixel,anchor);
  const g=this.geometry.objects.get(this.selectedSlot),shape=g.segments[i],before=this.getSpatialPose(),start=unprojectJoint(shape.start),end=unprojectJoint(shape.end);
  ({x,y}=unprojectSpatial({x,y},shape.end.rawPoint?.[2]??0,o,g.root));
  const span=Math.hypot(end.x-start.x,end.y-start.y),distance=Math.hypot(x-start.x,y-start.y);
  if(span<1e-6||distance<1e-6)return false;
  // Planar posing (and stretching) rotates in the view plane, preserving depth.
  const angle=Math.atan2(y-start.y,x-start.x)-Math.atan2(end.y-start.y,end.x-start.x);
  const parent=quatMultiply(shape.spatialFrame.q,inverseQuaternion(spatialQuaternion(before.bend,before.turn,before.pitch)));
  const world=quatMultiply(spatialQuaternion(angle,0,0),spatialWorldQuaternion(shape.spatialFrame.q,f,o));
  return this._setSpatialWorldOrientation(world,{parent},'Pose articulated joint',target=>{
   if(stretch){const lengths=target.len_flag?target.lengths.slice():f.segments.map(s=>s.length);lengths[i]*=distance/span;target.lengths=lengths;target.len_flag=1;}
  });
 },
 /** The bone keeps its length and swings in 3D so its end follows the pointer.
  * Inside its projected reach it leaves the view plane on the gesture's depth
  * side; `flip` mirrors that side. One swing from the fixed gesture start
  * keeps axial twist unchanged. */
 _arcSpatialJoint(x,y,flip,pixel=0,anchor=null){
  const o=this.object,g=this.geometry.objects.get(this.selectedSlot),gesture=this._spatialGesture('arc');
  if(gesture.length<1e-6)return false;
  const depth=gesture.origin[2]+gesture.direction[2]*gesture.length,p=unprojectSpatial({x,y},depth,o,g.root);
  // Motion is relative to the grab point, so grabbing beside a marker never
  // jumps. Short bones (chest, neck) use a longer virtual lever for control.
  // Without an anchor the bone end tracks the pointer directly.
  gesture.pointer??=anchor?unprojectSpatial(anchor,depth,o,g.root):{x:gesture.tip[0],y:gesture.tip[1]};
  const l=Math.max(gesture.length,pixel>0?70*pixel:0),d=gesture.direction;
  const dx=d[0]*l+p.x-gesture.pointer.x,dy=d[1]*l+p.y-gesture.pointer.y,reach=Math.hypot(dx,dy);
  let direction;
  if(reach>=l)direction=[dx/reach,dy/reach,0];
  else{const side=gesture.side*(flip?-1:1);direction=[dx/l,dy/l,side*Math.sqrt(l*l-reach*reach)/l];}
  if(reach<1e-9&&Math.abs(direction[2])<1e-9)return false;
  return this._setSpatialWorldOrientation(quatMultiply(betweenVectors(d,direction),gesture.world),gesture,'Pose articulated joint');
 },
 /** Travel of the selected slide (figure units from rest) or hinge (radians). */
 getSpatialMotion(index=this.selectedJoint){
  const f=this.figure,o=this.object,s=f?.segments[index],r=s?._stykRig?.spatial,m=r?.motion;if(!o||!m||!spatialBone(s))return null;
  const value=spatialMotionValue(r,{length:o.len_flag?o.lengths[index]:s.length,bend:m.type==='hinge'?this.getSpatialPose(index).bend:0});
  return{type:m.type,min:m.min,max:m.max,value,fraction:m.max>m.min?(value-m.min)/(m.max-m.min):0};
 },
 /** Set a mechanical joint's travel, clamped to its range; `fraction` maps 0–1 onto it. */
 setSpatialMotion(value,{fraction=false}={}){
  const m=this.getSpatialMotion();if(!m)return false;
  if(!Number.isFinite(value))throw new Error('Choose a finite position.');
  const target=Math.min(m.max,Math.max(m.min,fraction?m.min+value*(m.max-m.min):value)),i=this.selectedJoint,s=this.figure.segments[i],r=s._stykRig.spatial;
  const current=m.type==='slide'?(this.object.len_flag?this.object.lengths[i]:s.length):this.getSpatialPose().bend;
  const next=m.type==='slide'?Math.hypot(...r.tip.map((n,k)=>n-r.origin[k]))+target:target;
  if(Math.abs(next-current)<1e-12)return false;
  return this._objectEdit(m.type==='slide'?'Slide mechanical joint':'Turn hinge',o=>{
   if(m.type==='hinge')this._rotateJoint((next-current)*(o.image_text_flags?-1:1));
   else{o.lengths=o.len_flag?o.lengths.slice():this.figure.segments.map(s=>s.length);o.len_flag=1;o.lengths[i]=next;}
   delete o.runtime_segments;
  },{posed:true});
 },
 /** Pose drag on a slide or hinge: move to the point of its track nearest the
  * pointer, relative to where the handle was grabbed. The track is captured at
  * the gesture start, so a drag that returns to its start restores the pose. */
 _moveMechanicalJoint(x,y,anchor){
  const m=this.getSpatialMotion();if(!m||m.max<=m.min)return false;
  const f=this.figure,o=this.object,i=this.selectedJoint,key=`mechanism:${o.unique_id}:${i}`;
  let gesture=this._drag?.spatialGesture?.get(key);
  const g=this.geometry.objects.get(this.selectedSlot);
  if(!gesture){
   const frame=g.segments[i].spatialFrame,r=f.segments[i]._stykRig.spatial,tip=spatialPoint(frame,r.tip),pivot=spatialPoint(frame,r.origin);
   const axis=quatRotate(frame.q,m.type==='slide'?frame.axis:[0,0,1]);
   const world=p=>{const v=spatialWorldVector(p,f,o).map(n=>n*o.scale);return[v[0]+g.root.x,v[1]+g.root.y,v[2]];};
   const along=p=>{const d=p-m.value;if(m.type==='slide')return world(tip.map((n,k)=>n+axis[k]*d));
    const h=Math.sin(d/2),turned=quatRotate([axis[0]*h,axis[1]*h,axis[2]*h,Math.cos(d/2)],tip.map((n,k)=>n-pivot[k]));return world(turned.map((n,k)=>n+pivot[k]));};
   const start=along(m.value);
   gesture={along,start,grab:anchor?unprojectSpatial(anchor,start[2],o,g.root):{x:start[0],y:start[1]}};
   if(this._drag){this._drag.spatialGesture??=new Map();this._drag.spatialGesture.set(key,gesture);}
  }
  const pointer=unprojectSpatial({x,y},gesture.start[2],o,g.root),target=[gesture.start[0]+pointer.x-gesture.grab.x,gesture.start[1]+pointer.y-gesture.grab.y];
  const distance=p=>{const q=gesture.along(p);return(q[0]-target[0])**2+(q[1]-target[1])**2;};
  // Sample the track, then refine between the neighbours of the nearest sample.
  const steps=96,at=k=>m.min+(m.max-m.min)*k/steps;
  let best=0;for(let k=1;k<=steps;k++)if(distance(at(k))<distance(at(best)))best=k;
  let lo=at(Math.max(0,best-1)),hi=at(Math.min(steps,best+1));
  for(let n=0;n<40;n++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(a)<=distance(b))hi=b;else lo=a;}
  // Past either end the pointer lands exactly on that stop.
  const value=[m.min,m.max].reduce((v,end)=>distance(end)<=distance(v)?end:v,(lo+hi)/2);
  return this.setSpatialMotion(value)||true;
 },
 _clearSpatialIKDepth(){
  const o=this.object,s=this.figure?.segments[this.selectedJoint];if(o&&s)this._drag?.spatialGesture?.delete(`depth:${o.unique_id}:${s.segment_id}`);
 },
 /** Shift-drag on a hand or foot target: vertical travel moves it toward the
  * camera (down) or away (up) while its screen position stays fixed. */
 poseSpatialIKDepth(x,y,{pixel=1}={}){
  const f=this.figure,o=this.object,s=f?.segments[this.selectedJoint],c=o?._stykIK?.[s?.segment_id];
  if(!c?.enabled||!c.spatialTarget||c.bendDirection!==0||!this._drag||![x,y,pixel].every(Number.isFinite)||pixel<=0)return false;
  const key=`depth:${o.unique_id}:${s.segment_id}`;this._drag.spatialGesture??=new Map();
  if(!this._drag.spatialGesture.has(key))this._drag.spatialGesture.set(key,{y,depth:c.spatialTarget.depth});
  const gesture=this._drag.spatialGesture.get(key);
  this.setSpatialIKTarget({depth:gesture.depth+(y-gesture.y)/pixel*Math.abs(o.scale)*.5});return true;
 },
};
export {spatialBone,spatialSkin};
