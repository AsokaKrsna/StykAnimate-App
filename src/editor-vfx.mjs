import {createVfx,vfxStack,vfxProperty,validateVfxStack} from './vfx.mjs';
import {normalizeAnimationTarget} from './animation-channels.mjs';
import {VFX_PRESETS} from './vfx-presets.mjs';
import {effectAvailable} from './vfx-registry.mjs';
const copy=value=>structuredClone(value);
function targetFor(editor,target){
  target=normalizeAnimationTarget(target);if(!['scene','figure','segment'].includes(target.kind))throw new Error('Select a figure, node, movieclip, or Scene.');
  const layer=editor.getLayer(target.kind==='scene'?'scene':editor.layerForUid(target.uid));if(layer?.locked)throw new Error('Unlock this layer before editing effects.');
  if(editor.animationValue(target,'vfxStack')===undefined)throw new Error('This target is not present at this frame.');return target;
}
function owner(editor,target){return target.kind==='scene'?editor.evaluatedFrame:editor.evaluatedFrame.objects.find(o=>o.unique_id===target.uid);}
const freshId=()=>`fx-${globalThis.crypto.randomUUID().replaceAll('-','')}`;
export const editorVfxMethods={
  vfxEffects(target){return vfxStack(owner(this,target),target);},
  addVfx(targets,type){
    if(!Array.isArray(targets))targets=[targets];targets=targets.map(target=>targetFor(this,target));
    if(targets.some(target=>!effectAvailable(type,target.kind==='scene')))throw new Error('This effect is not available for the selected target.');
    const entries=[],ids=[];for(const target of targets){const stack=this.vfxEffects(target),effect=createVfx(type,freshId());ids.push(effect.id);
      entries.push({target,property:'vfxStack',tick:this.tick,value:validateVfxStack([...stack,effect]),interpolation:'constant',exactTarget:true});}
    this.addAnimationKeys(entries);return ids;
  },
  changeVfxStack(target,mutate){target=targetFor(this,target);const next=copy(this.vfxEffects(target));mutate(next);return this.addAnimationKey(target,'vfxStack',this.tick,validateVfxStack(next),{exactTarget:true});},
  removeVfx(target,id){return this.changeVfxStack(target,stack=>{const i=stack.findIndex(e=>e.id===id);if(i>=0)stack.splice(i,1);});},
  resetVfx(target,id){return this.changeVfxStack(target,stack=>{const i=stack.findIndex(e=>e.id===id);if(i<0)throw new Error('The effect no longer exists.');stack[i]=createVfx(stack[i].type,id);});},
  duplicateVfx(target,id){let newId;this.changeVfxStack(target,stack=>{const i=stack.findIndex(e=>e.id===id);if(i<0)throw new Error('The effect no longer exists.');newId=freshId();stack.splice(i+1,0,{...copy(stack[i]),id:newId});});return newId;},
  moveVfx(target,id,direction){if(![-1,1].includes(direction))throw new Error('Choose an effect order.');return this.changeVfxStack(target,stack=>{const i=stack.findIndex(e=>e.id===id),j=i+direction;if(i<0||j<0||j>=stack.length)return;[stack[i],stack[j]]=[stack[j],stack[i]];});},
  reorderVfx(target,id,index){return this.changeVfxStack(target,stack=>{const from=stack.findIndex(e=>e.id===id);if(from<0||!Number.isInteger(index)||index<0||index>=stack.length)throw new Error('Invalid effect position.');const [effect]=stack.splice(from,1);stack.splice(index,0,effect);});},
  pasteVfx(targets,stack){if(!Array.isArray(targets))targets=[targets];const effects=validateVfxStack(stack);this.addAnimationKeys(targets.map(t=>{const target=targetFor(this,t);return {target,property:'vfxStack',tick:this.tick,exactTarget:true,value:validateVfxStack([...this.vfxEffects(target),...effects.map(effect=>({...copy(effect),id:freshId()}))])};}));},
  setVfxParameter(target,id,param,value){target=targetFor(this,target);const effect=this.vfxEffects(target).find(e=>e.id===id);if(!effect)throw new Error('The effect no longer exists.');return this.addAnimationKey(target,vfxProperty(effect.type,id,param),this.tick,value,{exactTarget:true});},
  applyVfxPreset(targets,name){
    const preset=VFX_PRESETS[name]?.effects;if(!preset)throw new Error('Choose an available preset.');if(!Array.isArray(targets))targets=[targets];
    const entries=targets.map(target=>{target=targetFor(this,target);const effects=preset.map(([type,params])=>{const effect=createVfx(type,freshId());return {...effect,params:{...effect.params,...params}};});return {target,property:'vfxStack',tick:this.tick,value:validateVfxStack([...this.vfxEffects(target),...effects]),exactTarget:true};});return this.addAnimationKeys(entries);
  },
};
