import {animationRotation} from './animation-origin.mjs';
import {rigConstraintPlan} from './rig-constraints.mjs';
import {spatialBone,spatialSkin,quatMultiply,spatialQuaternion} from './rig-spatial.mjs';
import {inverseQuaternion,spatialWorldQuaternion,spatialPoleHandle,captureSpatialIK} from './ik-spatial.mjs';
import {ikChain,ikLayout,ikFollowerIndices,solveObjectIK} from './ik.mjs';
import {rigIKContext} from './ik-rig.mjs';

export const editorSpatialMethods={
 getSpatialIKPole(){
  const f=this.figure,o=this.object,s=f?.segments[this.selectedJoint],c=o?._stykIK?.[s?.segment_id];
  if(!c?.enabled||!c.spatialTarget||c.bendDirection!==0)return null;
  const pole=spatialPoleHandle(f,o,this.geometry.objects.get(this.selectedSlot),ikChain(f,s.segment_id,c.chainLength),c.spatialTarget);
  return pole?{...pole,handle:s.segment_id}:null;
 },
 setSpatialIKPole(x,y,depth){
  const pole=this.getSpatialIKPole();if(!pole)return false;
  if(![x,y,depth??pole.point[2]].every(Number.isFinite))throw new Error('Choose a finite IK pole position.');
  const v=[x-pole.center[0],y-pole.center[1],(depth??pole.point[2])-pole.center[2]],n=Math.hypot(...v);if(n<1e-6)return false;
  const f=this.figure,g=this.geometry.objects.get(this.selectedSlot);
  return this._objectEdit('Move IK pole',o=>{
   const c=o._stykIK[pole.handle],next={...c,spatialTarget:{...c.spatialTarget,pole:v.map(x=>x/n),swivel:0}};
   if(!c.pinned){
    const capture=captureSpatialIK(f,o,g,ikChain(f,pole.handle,c.chainLength),ikFollowerIndices(f,pole.handle),c.target.rotation);
    Object.assign(next,capture,{target:{...c.target,...g.joints.get(pole.handle)},spatialTarget:{...capture.spatialTarget,pole:v.map(x=>x/n),swivel:0}});
    const solved=solveObjectIK(f,o,g.root,ikLayout(f),{[pole.handle]:{...next,pinned:true}},{includePoints:false});o.angles=solved.angles;
   }
   o._stykIK={...o._stykIK,[pole.handle]:next};delete o.runtime_segments;
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
 setSpatialPose(patch){
  const before=this.getSpatialPose();if(!before)return false;
  for(const[k,v]of Object.entries(patch))if(!['bend','turn','pitch'].includes(k)||!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('Choose a finite joint rotation.');
  const f=this.figure,r=f.segments[this.selectedJoint]._stykRig.spatial,ids=rigConstraintPlan(f).ids;
  const frame=this.geometry.objects.get(this.selectedSlot).segments[this.selectedJoint].spatialFrame;
  const parent=quatMultiply(frame.q,inverseQuaternion(spatialQuaternion(before.bend,before.turn,before.pitch))),next={...before,...patch};
  const world=spatialWorldQuaternion(quatMultiply(parent,spatialQuaternion(next.bend,next.turn,next.pitch)),f,this.object),handle=f.segments[this.selectedJoint].segment_id;
  return this._objectEdit('Rotate articulated joint',o=>{
   if(patch.bend!==undefined)this._rotateJoint((patch.bend-before.bend)*(o.image_text_flags?-1:1));
   for(const key of ['turn','pitch'])if(patch[key]!==undefined)o.angles[ids.get(r[key])]+=(patch[key]-before[key])*(o.image_text_flags?-1:1);
   for(const [id,c]of Object.entries(o._stykIK??{}))if(c.enabled&&c.pinned&&c.spatialFollowers?.[handle])o._stykIK={...o._stykIK,[id]:{...c,spatialFollowers:{...c.spatialFollowers,[handle]:quatMultiply(spatialQuaternion(-c.target.rotation,0,0),world)}}};
  },{posed:true});
 },
 resetSpatialPose(all=false){
  if(!all)return this.setSpatialPose({bend:0,turn:0,pitch:0});
  const f=this.figure,o=this.object;if(!f||!o)return false;
  return this._objectEdit('Reset articulated rig',o=>{
   const delta=animationRotation(f,o),ids=rigConstraintPlan(f).ids;
   for(const s of f.segments)if(spatialBone(s))for(const id of [s.segment_id,s._stykRig.spatial.turn,s._stykRig.spatial.pitch]){const i=ids.get(id);o.angles[i]=f.segments[i].angle_rad*(o.image_text_flags?-1:1)+delta;}
   // Targets must release when the animator explicitly restores the rest pose.
   if(o._stykIK)o._stykIK=Object.fromEntries(Object.entries(o._stykIK).map(([id,c])=>[id,{...c,pinned:false}]));
  },{posed:true});
 },
 poseSpatialJoint(x,y,{stretch=false}={}){
  const f=this.figure,o=this.object,i=this.selectedJoint,s=f?.segments[i];if(!o||!spatialBone(s))return false;
  const g=this.geometry.objects.get(this.selectedSlot),angles=o.angles.slice();let lengths;
  if(stretch){lengths=o.len_flag?o.lengths.slice():f.segments.map(s=>s.length);const shape=g.segments[i],span=Math.hypot(shape.end.x-shape.start.x,shape.end.y-shape.start.y);if(span>1e-6)lengths[i]*=Math.hypot(x-shape.start.x,y-shape.start.y)/span;}
  const context=rigIKContext(f,o,g.root,[s.segment_id],angles,()=>lengths);context.refine([i],{x,y});
  const ids=rigConstraintPlan(f).ids,r=s._stykRig.spatial;
  return this._objectEdit('Pose articulated joint',target=>{
   this._rotateJoint(angles[i]-target.angles[i]);
   target.angles[ids.get(r.turn)]=angles[ids.get(r.turn)];target.angles[ids.get(r.pitch)]=angles[ids.get(r.pitch)];
   if(lengths){target.lengths=lengths;target.len_flag=1;}
  },{posed:true});
 },
};
export {spatialBone,spatialSkin};
