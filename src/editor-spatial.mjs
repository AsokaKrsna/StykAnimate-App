import {editorSpatialShapeMethods} from './editor-spatial-shape.mjs';
import {unprojectSpatial,unprojectJoint,projectSpatial,projection} from './spatial-projection.mjs';
import {geometryPlans} from './pivot/geometry-pose.mjs';
import {animationRotation} from './animation-origin.mjs';
import {rigConstraintPlan} from './rig-constraints.mjs';
import {spatialBone,spatialSkin,quatMultiply,quatRotate,spatialPoint,spatialQuaternion,quaternionPose} from './rig-spatial.mjs';
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
  if(!all)return this.setSpatialPose({bend:0,turn:0,pitch:0});
  const f=this.figure,o=this.object;if(!f||!o)return false;
  return this._objectEdit('Reset articulated rig',o=>{
   const delta=animationRotation(f,o),ids=rigPlan(this).ids;
   for(const s of f.segments)if(spatialBone(s))for(const id of [s.segment_id,s._stykRig.spatial.turn,s._stykRig.spatial.pitch]){const i=ids.get(id);o.angles[i]=f.segments[i].angle_rad*(o.image_text_flags?-1:1)+delta;}
   // Targets must release when the animator explicitly restores the rest pose.
   if(o._stykIK)o._stykIK=Object.fromEntries(Object.entries(o._stykIK).map(([id,c])=>[id,{...c,pinned:false}]));
  },{posed:true});
 },
 poseSpatialJoint(x,y,{stretch=false}={}){
  const f=this.figure,o=this.object,i=this.selectedJoint,s=f?.segments[i];if(!o||!spatialBone(s))return false;
  if(![x,y].every(Number.isFinite))return false;
  // A planted knee/elbow steers its existing bend plane directly. Its end
  // target stays planted; no separate canvas pole is needed.
  if(!stretch)for(const[id,c]of Object.entries(o._stykIK??{})){
   if(!c.enabled||!c.pinned||!c.spatialTarget||c.bendDirection!==0)continue;
   const chain=ikChain(f,Number(id),c.chainLength,layout(this));if(chain.length!==2||chain[0]!==i)continue;
   try{this.selectedJoint=rigPlan(this).ids.get(Number(id));const pole=this.getSpatialIKPole();return pole?this.setSpatialIKPole(x,y,pole.knee[2]):false;}
   finally{this.selectedJoint=i;}
  }
  const g=this.geometry.objects.get(this.selectedSlot),shape=g.segments[i],before=this.getSpatialPose(),start=unprojectJoint(shape.start),end=unprojectJoint(shape.end);
  ({x,y}=unprojectSpatial({x,y},shape.end.rawPoint?.[2]??0,o,g.root));
  const span=Math.hypot(end.x-start.x,end.y-start.y),distance=Math.hypot(x-start.x,y-start.y);
  if(span<1e-6||distance<1e-6)return false;
  // Pose in the view plane without an underdetermined three-axis solve.
  // This preserves foreshortening and axial twist, including closed drags.
  const angle=Math.atan2(y-start.y,x-start.x)-Math.atan2(end.y-start.y,end.x-start.x);
  const parent=quatMultiply(shape.spatialFrame.q,inverseQuaternion(spatialQuaternion(before.bend,before.turn,before.pitch)));
  const world=quatMultiply(spatialQuaternion(angle,0,0),spatialWorldQuaternion(shape.spatialFrame.q,f,o));
  const pose=quaternionPose(quatMultiply(inverseQuaternion(parent),spatialWorldQuaternion(world,f,o,true)),before);
  const ids=rigPlan(this).ids,r=s._stykRig.spatial;
  return this._objectEdit('Pose articulated joint',target=>{
   this._releaseSpatialChain(target);
   const sign=target.image_text_flags?-1:1;this._rotateJoint((pose.bend-before.bend)*sign);
   for(const key of ['turn','pitch'])target.angles[ids.get(r[key])]+=(pose[key]-before[key])*sign;
   if(stretch){const lengths=target.len_flag?target.lengths.slice():f.segments.map(s=>s.length);lengths[i]*=distance/span;target.lengths=lengths;target.len_flag=1;}
  },{posed:true});
 },
};
export {spatialBone,spatialSkin};
