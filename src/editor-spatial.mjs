import {animationRotation} from './animation-origin.mjs';
import {rigConstraintPlan} from './rig-constraints.mjs';
import {spatialBone,spatialSkin} from './rig-spatial.mjs';
import {rigIKContext} from './ik-rig.mjs';

export const editorSpatialMethods={
 getSpatialPose(index=this.selectedJoint){
  const f=this.figure,o=this.object,s=f?.segments[index];if(!o||!spatialBone(s))return null;
  const r=s._stykRig.spatial,delta=animationRotation(f,o),find=id=>{const i=f.segments.findIndex(s=>s.segment_id===id);return i<0?undefined:i;},parent=find(r.parent),turn=find(r.turn),pitch=find(r.pitch);
  const sign=o.image_text_flags?-1:1,parentAngle=parent===undefined?0:(o.angles[parent]-delta)*sign-f.segments[parent].angle_rad;
  return{bend:(o.angles[index]-delta)*sign-s.angle_rad-parentAngle,turn:(o.angles[turn]-delta)*sign-f.segments[turn].angle_rad,pitch:(o.angles[pitch]-delta)*sign-f.segments[pitch].angle_rad};
 },
 setSpatialPose(patch){
  const before=this.getSpatialPose();if(!before)return false;
  for(const[k,v]of Object.entries(patch))if(!['bend','turn','pitch'].includes(k)||!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('Choose a finite joint rotation.');
  const f=this.figure,r=f.segments[this.selectedJoint]._stykRig.spatial,ids=rigConstraintPlan(f).ids;
  return this._objectEdit('Rotate articulated joint',o=>{
   if(patch.bend!==undefined)this._rotateJoint((patch.bend-before.bend)*(o.image_text_flags?-1:1));
   for(const key of ['turn','pitch'])if(patch[key]!==undefined)o.angles[ids.get(r[key])]+=(patch[key]-before[key])*(o.image_text_flags?-1:1);
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
