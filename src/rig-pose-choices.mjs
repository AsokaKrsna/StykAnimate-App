import {messageError} from './localized-error.mjs';
/** Named, mutually exclusive poses for existing spatial length channels.
 * Selection is derived from those channels; there is no extra animation state. */
export function validatePoseChoice(segment){
 const c=segment._stykPoseChoice;if(c===undefined)return;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['group','label','shown','hidden'].includes(k))||
  !['group','label'].every(k=>typeof c[k]==='string'&&c[k].trim()&&c[k].length<=80)||
  !['shown','hidden'].every(k=>Number.isFinite(c[k])&&c[k]>=0&&c[k]<=1e6)||c.shown===c.hidden||
  !segment._stykRig?.spatial?.origin||segment.length<=0)throw messageError(new Error(''), "errors.rigPoseChoices.aPoseChoiceNeedsASpatialBoneNames", {});
}
export function poseChoiceGroups(figure,object){
 if(!figure||!object)return[];
 const groups=new Map();
 figure?.segments.forEach((s,index)=>{const c=s._stykPoseChoice;if(!c)return;let group=groups.get(c.group);
  if(!group){group={name:c.group,choices:[]};groups.set(c.group,group);}
  group.choices.push({id:s.segment_id,index,...c,length:object.len_flag?object.lengths[index]:s.length});
 });
 return [...groups.values()].map(group=>{
  const near=(a,b)=>Math.abs(a-b)<1e-5,shown=group.choices.filter(c=>near(c.length,c.shown));
  const hidden=group.choices.every(c=>near(c.length,c.hidden)),selected=shown.length===1&&group.choices.every(c=>c===shown[0]||near(c.length,c.hidden));
  return{...group,value:hidden?0:selected?shown[0].id:-1};
 });
}
