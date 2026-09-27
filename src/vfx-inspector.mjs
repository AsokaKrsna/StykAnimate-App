import {clipInspectorHTML,clipKeyControls,clipClick,clipChange,selectClip} from './vfx-clip-inspector.mjs';
import {focusClipBinding,groupDragStart,groupDragOver,groupDrop,groupDragEnd,groupKeydown} from './vfx-clip-controls.mjs';
import {vfxClipActiveAt} from './vfx-clips.mjs';
import {connectedVfxConflict} from './vfx-connected.mjs';
import {VFX_REGISTRY,VFX_LIMIT,vfxProperty,resolvedVfx} from './vfx.mjs';
import {effectAvailable} from './vfx-registry.mjs';
import {VFX_PRESETS,PRESET_CATEGORIES,presetAvailable} from './vfx-presets.mjs';
import {prewarmAtlas} from './vfx-generator-atlas.mjs';
import {hasEffectPreview,cachedEffectPreview,requestEffectPreview} from './vfx-preset-preview.mjs';
// Generated effects lead the catalogue; other categories keep registry order.
const FIRST_CATEGORIES=['Generate',...PRESET_CATEGORIES],categoryRank=name=>{const i=FIRST_CATEGORIES.indexOf(name);return i<0?FIRST_CATEGORIES.length:i;};
import {vfxPaint} from './vfx-paint.mjs';
import {vfxDescriptor} from './vfx.mjs';
import {paintCSS} from './paint.mjs';
import {openColorPicker} from './color-picker.mjs';
import {PropertyControls} from './property-controls.mjs';
import {updateInspectorDOM} from './inspector-dom.mjs';
import {icon} from './icons.mjs';
import {vfxIcon} from './vfx-icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const identity=(target,id)=>JSON.stringify(target)+'/'+id;
const actionIcons={up:'chevron-up',down:'chevron-down',duplicate:'duplicate',reset:'undo',remove:'trash',copy:'duplicate'};
/** UI-only selection, popup and disclosure state; every edit uses the existing exposure transaction. */
export class VfxInspector {
 /** `requestVisible(visible)` asks the shell to show or leave the VFX panel; the shell's dock host shows
  #vfx-panel and calls panelVisible(), and derives the timeline's VFX rows from the panel's visibility. */
 constructor({editor,root,beforeEdit,onChange,onError,requestVisible,context=()=>''}){
  Object.assign(this,{editor,root,beforeEdit,onChange,onError,requestVisible,context});
  this.scope='selection';this.visible=false;this.bindings=new Map();this.collapsed=new Set();this.abort=new AbortController();this.selected=null;
  this.controls=new PropertyControls(root,{
   canHandle:key=>this.bindings.has(key),
   getValue:key=>this.readBinding(this.bindings.get(key)),
   begin:({key})=>{this.beforeEdit();const b=this.bindings.get(key);if(b.clip){focusClipBinding(this,b);editor.beginVfxClipEdit();return b;}b.stack=structuredClone(editor.vfxEffects(b.target));editor.beginAnimationEdit(b.target,b.derived?'vfxStack':b.property,{exactTarget:true});return b;},
   preview:({key,value,token:b})=>{if(b.clipField){editor.setVfxClip(b.clip,{[b.clipField]:value/b.factor-b.offset});}else if(b.clip){editor.setVfxClipParameter(b.clip,b.id,b.param,value/b.factor);}else if(b.derived){const next=structuredClone(b.stack),effect=next.find(e=>e.id===b.id),p={...resolvedVfx(effect).params},angle=b.param==='angle'?value*Math.PI/180:Math.atan2(p.offsetY,p.offsetX),distance=b.param==='distance'?value:Math.hypot(p.offsetX,p.offsetY);Object.assign(effect.params,{offsetX:Math.max(-256,Math.min(256,Math.cos(angle)*distance)),offsetY:Math.max(-256,Math.min(256,Math.sin(angle)*distance))});editor.previewAnimationEdit(next);}else editor.previewAnimationEdit(value/b.factor);for(const input of root.querySelectorAll('input[data-property]'))if(input.dataset.property===key){input.value=value;input.style.setProperty('--vfx-progress',`${100*(value-Number(input.min))/(Number(input.max)-Number(input.min))}%`);}this.onChange();},
   commit:()=>{editor.commitVfxClipEdit();editor.commitAnimationEdit();this.sync();this.onChange();},cancel:()=>{editor.cancelVfxClipEdit();editor.cancelAnimationEdit();this.sync();this.onChange();},onError:error=>this.onError(error),
  });
  const listen=(name,fn)=>root.addEventListener(name,e=>this.run(()=>fn.call(this,e)),{signal:this.abort.signal});
  listen('input',function(event){if(event.target.hasAttribute('data-clip-search'))clipChange(this,event);});listen('click',this.click);listen('change',this.change);listen('keydown',this.keydown);listen('dragstart',this.dragstart);listen('dragover',this.dragover);listen('drop',this.drop);listen('dragend',this.dragend);
  listen('property-edit-end',this.sync);
  editor.addEventListener('change',({detail})=>{
   if(detail?.kind==='vfx-channels')this.sync();
   if(detail?.kind==='vfx-selection'){this.selectedClip=editor._selectedVfxClip;const clip=editor.getVfxClips().find(c=>c.id===this.selectedClip);if(clip){this.scope=clip.target.kind==='scene'?'scene':clip.target.kind==='figure'?(clip.includeAttached?'connected':'figure'):'selection';if(detail.source==='timeline'&&(this.clipView??'playhead')==='playhead'&&!vfxClipActiveAt(clip,editor.tick))this.clipView='selected';}this.sync();this.onChange();}
   if(detail?.kind==='history'){this.finishForHistory();this.sync();}
   if(['document','selection'].includes(detail?.kind)){this.scope='selection';this.selected=null;this.selectedClip=null;editor._selectedVfxClip=null;editor._selectedVfxKey=null;if(detail.kind==='document'){this.collapsed.clear();this.clipQuery='';}this.closePopup();this.sync();this.onChange();}
  },{signal:this.abort.signal});
 }
 bindingEffects(b){return b.clip?this.editor.sampleVfxClip(b.clip):this.editor.vfxEffects(b.target);}
 readBinding(b){if(b.clipField)return (this.editor.getVfxClips().find(c=>c.id===b.clip)[b.clipField]+b.offset)*b.factor;const p=resolvedVfx(this.bindingEffects(b).find(e=>e.id===b.id)).params;return b.derived?(b.param==='angle'?Math.atan2(p.offsetY,p.offsetX)*180/Math.PI:Math.hypot(p.offsetX,p.offsetY)):p[b.param]*b.factor;}
 setVisible(visible){if(this.requestVisible)this.requestVisible(visible);else this.panelVisible(visible);}
 /** The shell showed or hid the VFX panel (panel registry onVisibility). */
 panelVisible(visible){this.commit();this.visible=visible;if(visible)prewarmAtlas();if(!visible)this.closePopup();this.sync();this.onChange();}
 get active(){return this.controls.active;}
 commit(){this.controls.commit();}
 cancel(){this.controls.cancel();}
 ownsHistoryTarget(target){return Boolean(this.root.contains(target)&&target.matches('input[data-property],select[data-vfx-choice],select[data-clip-easing]'));}
 finishForHistory(){this.commit();const input=this.root.ownerDocument.activeElement;if(this.ownsHistoryTarget(input))input.blur();}
 run(fn){try{fn();}catch(error){this.onError(error);}}
 targets(){const e=this.editor;if(this.scope==='scene'||this.scope==='selection'&&this.context()==='scene')return [{kind:'scene'}];const objects=e.selectedObjects??[];if(!objects.length)return [];if(this.scope==='selection'&&objects.length===1&&e.selectedJoint>=0&&!e.figure?._styk?.movieclip){const segment=e.figure?.segments?.[e.selectedJoint];if(segment)return [{kind:'segment',uid:e.object.unique_id,handleId:segment.segment_id,figureTypeId:e.object.figure_type_id}];}return objects.map(o=>({kind:'figure',uid:o.unique_id}));}
 targetIcon(target){if(target?.kind==='scene')return vfxIcon('camera');if(target?.kind==='segment')return icon('nodes');const object=this.editor.evaluatedFrame?.objects.find(o=>o.unique_id===target?.uid),figure=this.editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id);return figure?._styk?.movieclip?vfxIcon('movieclip'):icon('person');}
 ownerName(target){if(target.kind==='scene')return 'Scene';const object=this.editor.evaluatedFrame.objects.find(o=>o.unique_id===target.uid),figure=this.editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id);return `${figure?.name||'Figure'}${target.kind==='segment'?` · Node ${target.handleId}`:''}`;}
 selectedEffect(){if(!this.visible)return null;if(this.selectedClip){const clip=this.editor.getVfxClips().find(c=>c.id===this.selectedClip);if(!clip||!vfxClipActiveAt(clip,this.editor.tick))return null;const effects=this.editor.sampleVfxClip(clip.id),effect=effects.find(e=>e.id===this.selectedClipEffect)??effects[0];return effect?{target:clip.target,effect,clip:clip.id,includeAttached:clip.includeAttached}:null;}if(!this.selected)return null;const {target,id}=this.selected;if(!this.targets().some(t=>JSON.stringify(t)===JSON.stringify(target)))return null;const effect=this.editor.vfxEffects(target).find(e=>e.id===id);return effect?{target,effect:resolvedVfx(effect)}:null;}
 select(target,id){this.selected={target,id};this.selectedClip=null;this.editor._selectedVfxClip=null;this.editor._selectedVfxKey=null;if(target.kind==='figure')this.scope=this.editor.animationValue(target,'vfxScope')?'connected':'figure';for(const owner of this.targets())for(const effect of this.editor.vfxEffects(owner))this.collapsed.add(identity(owner,effect.id));this.collapsed.delete(identity(target,id));this.editor._emit('vfx-selection');this.sync();this.onChange();}
 field(target,effect,param,d,ownerIndex,locked,derived=false){
  const property=derived?'vfxStack':vfxProperty(effect.type,effect.id,param),key=`${ownerIndex}-${effect.id}-${param}`,factor=d.unit==='%'?100:1,b={target,id:effect.id,param,property,factor,derived,clip:this.renderingClip};this.bindings.set(key,b);
  const value=derived?this.readBinding(b):effect.params[param],label=`${VFX_REGISTRY[effect.type].name} ${d.label}`;
  if(d.type==='color')return `<div class="vfx-field"><label>${esc(d.label)}</label><button type="button" class="vfx-paint" data-vfx-paint="${key}" style="--paint:${esc(paintCSS(vfxPaint(value)))}" aria-label="${esc(label)}" title="${esc(label)}" ${locked?'disabled':''}><span></span>${icon('chevron-down')}</button></div>`;
  if(d.options)return `<div class="vfx-field"><label for="vfx-field-${key}">${esc(d.label)}</label>${d.toggle?`<button type="button" class="vfx-toggle" data-vfx-toggle="${key}" aria-label="${esc(label)}" aria-pressed="${Boolean(value)}" ${locked?'disabled':''}><i></i></button>`:`<select id="vfx-field-${key}" data-vfx-choice="${key}" aria-label="${esc(label)}" ${locked?'disabled':''}>${d.options.map((name,i)=>`<option value="${i}" ${i===value?'selected':''}>${esc(name)}</option>`).join('')}</select>`}</div>`;
  const actual=value*factor,min=d.min*factor,max=d.max*factor,step=d.step*factor;
  return `<div class="vfx-parameter"><div class="vfx-field" data-property-row="${key}"><label class="property-scrub" data-property-scrub="${key}" for="vfx-field-${key}">${esc(d.label)}</label><div class="vfx-value"><input type="number" id="vfx-field-${key}" data-property="${key}" data-property-scrub="${key}" data-property-value="${actual}" data-property-step="${step}" data-property-precision="${d.discrete?0:2}" value="${+actual.toFixed(2)}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}" ${locked?'disabled':''}>${d.unit?`<span aria-hidden="true">${esc(d.unit)}</span>`:''}</div></div>${d.discrete||max-min>10000?'':`<input class="vfx-slider" type="range" data-property="${key}" data-property-value="${actual}" data-property-step="${step}" data-property-precision="2" value="${actual}" min="${min}" max="${max}" step="${step}" style="--vfx-progress:${100*(actual-min)/(max-min)}%" aria-label="${esc(label+' slider')}" ${locked?'disabled':''}>`}</div>`;
 }
 sync(){if(this.syncing){this.syncAgain=true;return;}this.syncing=true;try{this.renderSync();}finally{this.syncing=false;if(this.syncAgain){this.syncAgain=false;queueMicrotask(()=>this.sync());}}}
 renderSync(){
  if(!this.visible||this.active)return;const targets=this.targets(),e=this.editor;this.bindings.clear();
  const scene=targets[0]?.kind==='scene';if(e._vfxTimelineScene!==scene){e._vfxTimelineScene=scene;e._emit('vfx-target');}
  const stacks=targets.map(target=>({target,effects:e.vfxEffects(target).map(resolvedVfx),locked:e.getLayer(target.kind==='scene'?'scene':e.layerForUid(target.uid))?.locked}));
  const connectedControls=({target})=>{if(target.kind!=='figure')return '';const enabled=Boolean(e.animationValue(target,'vfxScope'))||e.getVfxClips(target).some(c=>c.includeAttached),conflict=enabled&&connectedVfxConflict(e.evaluatedFrame,target.uid);return conflict?`<p role="status">${esc(conflict)} Effects currently apply to this part only.</p>`:'';};
  const view=this.clipView??'playhead',query=(this.clipQuery??'').toLowerCase();
  const legacy=stacks.map(s=>({...s,shown:s.effects.filter(effect=>view==='selected'?this.selected&&identity(s.target,effect.id)===identity(this.selected.target,this.selected.id):view==='all'?!query||VFX_REGISTRY[effect.type].name.toLowerCase().includes(query):effect.enabled&&(effect.params.effectStrength??1)>0)}));
  const body=legacy.filter(s=>s.shown.length).map(({target,effects,shown,locked},ownerIndex)=>`${targets.length>1?`<h3 class="vfx-owner-name">${this.targetIcon(target)}${esc(this.ownerName(target))}</h3>`:''}${shown.map(effect=>{
   const index=effects.indexOf(effect);
   const definition=VFX_REGISTRY[effect.type],owner=JSON.stringify(target),id=effect.id,selected=this.selected&&identity(target,id)===identity(this.selected.target,this.selected.id),collapsed=this.collapsed.has(identity(target,id));
   const fields=Object.entries(definition.params).filter(([,d])=>!d.when||Object.entries(d.when).every(([key,values])=>values.includes(effect.params[key])));
   const render=entries=>entries.map(([param,d])=>this.field(target,effect,param,d,ownerIndex,locked)).join('');
   const normal=render(fields.filter(([,d])=>!d.advanced)),advanced=render(fields.filter(([,d])=>d.advanced));
   const shadow=effect.type==='shadow'?['angle','distance'].map(param=>this.field(target,effect,param,{label:param==='angle'?'Angle':'Distance',type:'number',min:param==='angle'?-180:0,max:param==='angle'?180:256,step:1,unit:param==='angle'?'°':'px'},ownerIndex,locked,true)).join(''):'';
   const action=(name,label,disabled=false)=>`<button type="button" data-vfx-action="${name}" title="${esc(label)}" aria-label="${esc(definition.name+' '+label.toLowerCase())}" ${locked||disabled?'disabled':''}>${icon(actionIcons[name])}<span>${label}</span></button>`;
   return `<section class="vfx-effect${effect.enabled?'':' is-disabled'}${selected?' is-selected':''}" data-section="vfx-${ownerIndex}-${id}" data-vfx-id="${id}" data-vfx-target="${esc(owner)}"><div class="vfx-effect-header"><button type="button" class="vfx-grip" draggable="${!locked}" data-vfx-drag title="Drag to reorder · Alt+↑/↓" aria-label="Reorder ${esc(definition.name)}" ${locked?'disabled':''}>${vfxIcon('grip')}</button><button type="button" class="vfx-disclosure" data-vfx-action="collapse" aria-label="${collapsed?'Expand':'Collapse'} ${esc(definition.name)}" aria-expanded="${!collapsed}">${icon(collapsed?'chevron-right':'chevron-down')}</button><button type="button" class="vfx-effect-title" data-vfx-action="select" aria-pressed="${Boolean(selected)}">${vfxIcon(definition.icon)}<span>${esc(definition.name)}</span></button><button type="button" class="vfx-enable" data-vfx-action="enable" title="${effect.enabled?'Disable':'Enable'} effect" aria-label="Enable ${esc(definition.name)}" aria-pressed="${effect.enabled}" ${locked?'disabled':''}>${icon(effect.enabled?'eye':'eye-off')}</button><details class="vfx-menu"><summary aria-label="${esc(definition.name)} actions">${icon('more')}</summary><div>${action('up','Move up',!index)}${action('down','Move down',index===effects.length-1)}${action('copy','Copy')}${action('duplicate','Duplicate',effects.length>=VFX_LIMIT)}${action('reset','Reset')}${action('remove','Remove')}</div></details></div><div class="vfx-effect-body" ${collapsed?'hidden':''}>${normal}${shadow}${advanced?`<details class="vfx-advanced"><summary>More</summary>${advanced}</details>`:''}<div class="vfx-quick">${action('duplicate','Duplicate',effects.length>=VFX_LIMIT)}${action('reset','Reset')}${action('remove','Remove')}</div></div></section>`;
  }).join('')}`).join('');
  const clipBody=stacks.map(connectedControls).join('')+clipInspectorHTML(this,targets,{legacyCount:stacks.reduce((n,s)=>n+s.effects.length,0),legacyVisible:Boolean(body)});
  const disabled=!targets.length||stacks.some(s=>s.locked);
  const scope=this.scope==='selection'?(scene?'scene':targets[0]?.kind==='segment'?'selection':stacks.some(s=>s.effects.length)&&!stacks.some(s=>e.animationValue(s.target,'vfxScope'))?'figure':'connected'):this.scope;
  updateInspectorDOM(this.root,`<div class="vfx-toolbar"><label class="vfx-target-label" for="vfx-scope">Apply to</label><div class="vfx-target">${this.targetIcon(targets[0])}<select id="vfx-scope" aria-label="Effect target">${e.selectedJoint>=0?`<option value="selection" ${scope==='selection'?'selected':''}>Selected node</option>`:''}<option value="figure" ${scope==='figure'?'selected':''}>This part</option><option value="connected" ${scope==='connected'?'selected':''}>Whole figure</option><option value="scene" ${scope==='scene'?'selected':''}>Scene</option></select></div></div><div class="vfx-actions"><button type="button" class="vfx-add-button" data-vfx-action="add" ${disabled?'disabled':''}>${icon('plus')}<span>Add effect</span></button><button type="button" class="vfx-presets-button" data-vfx-action="presets" title="Ready-made effects such as Explosion, Aura, Rain or Neon" aria-label="Effect presets" ${disabled?'disabled':''}>${vfxIcon('effects')}<span>Presets</span></button>${this.clipboard?`<button type="button" class="vfx-paste-button" data-vfx-action="paste" title="Paste effect" aria-label="Paste effect" ${!targets.length||stacks.some(s=>s.locked)?'disabled':''}>${icon('duplicate')}</button>`:''}</div><div class="vfx-stack">${clipBody}${body?`<details class="vfx-legacy" open><summary>Pose effects</summary>${body}</details>`:''}</div><div class="vfx-key-dock">${clipKeyControls(this)}</div>`,{preserveDisclosure:true});
 }
 click(event){
  // Numeric focus selects through PropertyControls.begin. Other controls select
  // on activation, so revealing key navigation cannot move a button mid-click.
  if(!event.target.closest('[data-clip-key],[data-clip-key-property]'))focusClipBinding(this,this.bindings.get(event.target.closest('[data-vfx-binding]')?.dataset.vfxBinding));
  if(clipClick(this,event))return;
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.vfxPaint){const b=this.bindings.get(button.dataset.vfxPaint),effect=resolvedVfx(this.bindingEffects(b).find(e=>e.id===b.id));this.commit();this.beforeEdit();if(b.clip)focusClipBinding(this,b);else this.select(b.target,b.id);this.closeColor?.();this.closeColor=openColorPicker({anchor:button,paint:vfxPaint(effect.params[b.param]),gradients:true,alpha:true,onChange:paint=>{this.setBinding(b,paint);this.sync();this.onChange();}});return;}
  if(button.dataset.vfxToggle){const b=this.bindings.get(button.dataset.vfxToggle);this.commit();this.beforeEdit();this.setBinding(b,Number(button.getAttribute('aria-pressed')!=='true'));this.sync();this.onChange();return;}
  const action=button.dataset.vfxAction,row=button.closest('[data-vfx-id]');if(!action)return;
  const target=row?JSON.parse(row.dataset.vfxTarget):null,id=row?.dataset.vfxId;
  if(action==='select'){this.select(target,id);return;}
  if(action==='collapse'){const key=identity(target,id);this.collapsed.has(key)?this.collapsed.delete(key):this.collapsed.add(key);this.sync();return;}
  if(action==='add'||action==='presets'){this.addToGroup=null;this.commit();this.openPopup(button,action);return;}
  if(action==='quick'){this.commit();const [mode,key]=button.dataset.vfxQuick.split(':');this.addChoice(mode,key);return;}
  if(action==='show-all'){this.clipView='all';this.sync();return;}
  if(action==='copy'){this.clipboard=structuredClone([this.editor.vfxEffects(target).find(e=>e.id===id)]);this.clipboardScope=target.kind==='figure'?Boolean(this.editor.animationValue(target,'vfxScope')):undefined;this.sync();return;}
  this.commit();this.beforeEdit();
  if(action==='paste')this.editor.pasteVfx(this.targets(),this.clipboard,{includeAttached:this.clipboardScope});
  if(action==='enable'){const effect=this.editor.vfxEffects(target).find(e=>e.id===id);this.editor.setVfxParameter(target,id,'enabled',Number(!effect.enabled));}
  if(action==='remove'){this.editor.removeVfx(target,id);if(this.selected?.id===id)this.selected=null;}
  if(action==='duplicate')this.select(target,this.editor.duplicateVfx(target,id));
  if(action==='reset')this.editor.resetVfx(target,id);
  if(action==='up'||action==='down')this.editor.moveVfx(target,id,action==='up'?-1:1);
  for(const menu of this.root.querySelectorAll('.vfx-menu'))menu.open=false;this.sync();this.onChange();
 }
 setBinding(b,value){return b.clip?this.editor.setVfxClipParameter(b.clip,b.id,b.param,value):this.editor.setVfxParameter(b.target,b.id,b.param,value);}
 change(event){if(clipChange(this,event))return;const input=event.target;if(input.id==='vfx-scope'){
  const scope=input.value;this.commit();this.beforeEdit();const clip=this.root.querySelector('.vfx-clip.is-selected')&&this.editor.getVfxClips().find(c=>c.id===this.selectedClip);
  if(['figure','connected'].includes(scope)){
   if(clip?.target.kind==='figure'&&this.editor.selectedUids.has(clip.target.uid))this.editor.setVfxClip(clip.id,{includeAttached:scope==='connected'});
   else if(!clip)this.editor.movieclipBatch('Change effect target',()=>{for(const object of this.editor.selectedObjects){const target={kind:'figure',uid:object.unique_id};if(this.editor.vfxEffects(target).length)this.editor.setVfxScope(target,scope==='connected');}});
  }
  this.scope=scope;this.selected=null;this.closePopup();this.sync();this.onChange();
 }else if(input.dataset.vfxChoice){
  // A style choice brings its own suggested colours and settings in the same undo step.
  const b=this.bindings.get(input.dataset.vfxChoice),value=Number(input.value),applies=b.clip&&vfxDescriptor(b.property)?.applies?.[value];this.commit();this.beforeEdit();
  if(applies)this.editor.setVfxClipParameters(b.clip,b.id,{[b.param]:value,...applies});else this.setBinding(b,value);this.sync();this.onChange();}}
 keydown(event){if(groupKeydown(this,event))return;if(event.key==='Escape'){this.closePopup();this.selected=null;for(const menu of this.root.querySelectorAll('.vfx-menu'))menu.open=false;this.sync();this.onChange();}if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)&&event.target.closest('[data-vfx-drag]')){event.preventDefault();const row=event.target.closest('[data-vfx-id]');this.commit();this.beforeEdit();this.editor.moveVfx(JSON.parse(row.dataset.vfxTarget),row.dataset.vfxId,event.key==='ArrowUp'?-1:1);this.sync();this.onChange();}}
 dragstart(event){if(groupDragStart(this,event))return;const grip=event.target.closest('[data-vfx-drag]');if(!grip){event.preventDefault();return;}const row=grip.closest('[data-vfx-id]');this.dragged={target:row.dataset.vfxTarget,id:row.dataset.vfxId};event.dataTransfer.setData('application/x-styk-vfx',JSON.stringify(this.dragged));event.dataTransfer.effectAllowed='move';row.classList.add('is-dragging');}
 dragover(event){if(groupDragOver(this,event))return;const row=event.target.closest('[data-vfx-id]');if(!this.dragged||row?.dataset.vfxTarget!==this.dragged.target)return;event.preventDefault();event.dataTransfer.dropEffect='move';for(const item of this.root.querySelectorAll('.is-drop-target'))item.classList.remove('is-drop-target');row.classList.add('is-drop-target');}
 drop(event){if(groupDrop(this,event))return;const row=event.target.closest('[data-vfx-id]');if(!this.dragged||row?.dataset.vfxTarget!==this.dragged.target)return;event.preventDefault();const target=JSON.parse(this.dragged.target),index=this.editor.vfxEffects(target).findIndex(e=>e.id===row.dataset.vfxId);this.commit();this.beforeEdit();this.editor.reorderVfx(target,this.dragged.id,index);this.dragend();this.sync();this.onChange();}
 dragend(){groupDragEnd(this);this.dragged=null;for(const row of this.root.querySelectorAll('.is-dragging,.is-drop-target'))row.classList.remove('is-dragging','is-drop-target');}
 closePopup(){this.popup?.remove();this.popup=null;}
 /** Add one effect or preset to every current target (or the open group) as one undo step. */
 addChoice(mode,key){
  this.beforeEdit();const targets=this.targets(),options={includeAttached:this.root.querySelector('#vfx-scope')?.value==='connected'};
  this.editor.movieclipBatch('Add effects',()=>{if(this.addToGroup){this.editor.addVfxGroupEffect(this.addToGroup,key);}else for(const target of targets){const id=mode==='presets'?this.editor.addVfxGroup(target,key,options):this.editor.addVfxClip(target,key,options);selectClip(this,id);}});
  this.addToGroup=null;this.closePopup();this.sync();this.onChange();
 }
 /** Empty panel: explain effects and offer one-click starting points. */
 emptyHTML(total,view,locked){
  const scene=this.targets()[0]?.kind==='scene';
  const effects=(scene?['grade','vignette','bloom','crt']:['glow','outline','shadow','blur']).filter(type=>effectAvailable(type,scene));
  const presets=(scene?['Golden hour','Retro screen']:['Power up','Neon','Hit flash']).filter(name=>VFX_PRESETS[name]&&presetAvailable(VFX_PRESETS[name],scene,effectAvailable));
  const generated=['particles','aura','beam','explosion','smoke'].filter(type=>effectAvailable(type,scene));
  const chip=(mode,key,label,art)=>`<button type="button" class="ds-chip" data-vfx-action="quick" data-vfx-quick="${mode}:${esc(key)}" aria-label="Add ${esc(label)}" ${locked?'disabled':''}>${vfxIcon(art)}${esc(label)}</button>`;
  const elsewhere=view==='playhead'&&total?`<button type="button" class="vfx-show-all" data-vfx-action="show-all">${total} on other frames · Show all</button>`:'';
  return `<div class="ds-empty vfx-empty-state"><strong>${view==='playhead'&&total?'No effects at this frame':'No effects yet'}</strong><div class="ds-empty-actions">${effects.map(type=>chip('add',type,VFX_REGISTRY[type].name,VFX_REGISTRY[type].icon)).join('')}</div><div class="ds-empty-actions vfx-empty-generated" aria-label="Particles and energy">${generated.map(type=>chip('add',type,VFX_REGISTRY[type].name,VFX_REGISTRY[type].icon)).join('')}</div><div class="ds-empty-actions">${presets.map(name=>chip('presets',name,name,VFX_PRESETS[name].icon)).join('')}</div>${elsewhere}</div>`;
 }
 openPopup(anchor,mode){
  this.closePopup();const scene=this.targets()[0]?.kind==='scene',popup=this.popup=document.createElement('div');popup.className='vfx-catalog';popup.setAttribute('popover','auto');popup.setAttribute('role','dialog');popup.setAttribute('aria-label',mode==='presets'?'VFX presets':'Add effect');
  const tabs=this.addToGroup?'':`<div class="ds-segmented vfx-catalog-tabs" role="tablist" aria-label="Catalogue">${[['add','Effects'],['presets','Presets']].map(([id,label])=>`<button type="button" role="tab" data-catalog-mode="${id}" aria-selected="${mode===id}">${label}</button>`).join('')}</div>`;
  popup.innerHTML=tabs+`<div class="vfx-catalog-search">${icon('search')}<input type="search" placeholder="${mode==='presets'?'Search presets':'Search effects'}" aria-label="Search ${mode==='presets'?'presets':'effects'}"></div><div class="vfx-catalog-results"></div>`;document.body.append(popup);popup.showPopover();
  const available=mode==='presets'?Object.entries(VFX_PRESETS).filter(([,p])=>presetAvailable(p,scene,effectAvailable)).map(([name,p])=>({key:name,name,icon:p.icon,category:p.category??'Presets',count:p.effects.length,preview:hasEffectPreview(mode,name)})):Object.entries(VFX_REGISTRY).filter(([type])=>effectAvailable(type,scene)).map(([key,d])=>({key,...d,count:1,preview:hasEffectPreview(mode,key)}));
  // Generated effects show a rendered still, filled in as previews finish.
  const art=item=>{if(!item.preview)return `<span class="vfx-catalog-art vfx-art-${item.icon}">${vfxIcon(item.icon)}</span>`;const url=cachedEffectPreview(mode,item.key);return `<span class="vfx-catalog-art vfx-art-${item.icon}${url?' has-preview':''}" data-preview="${esc(item.key)}">${url?`<img alt="" src="${url}">`:vfxIcon(item.icon)}</span>`;};
  const draw=()=>{const query=popup.querySelector('input').value.toLowerCase(),items=available.filter(item=>(item.name+' '+item.category).toLowerCase().includes(query));popup.querySelector('.vfx-catalog-results').innerHTML=[...new Set(items.map(i=>i.category))].sort((a,b)=>categoryRank(a)-categoryRank(b)).map(category=>{const list=items.filter(i=>i.category===category);return `<section><h3>${esc(category)}</h3><div class="vfx-catalog-grid${list.every(i=>i.preview)?' is-previews':''}">${list.map(item=>`<button type="button" class="vfx-catalog-card" data-choice="${esc(item.key)}" title="${esc(item.name)}" ${this.addToGroup&&this.editor.getVfxClips().find(c=>c.id===this.addToGroup)?.effects.length+item.count>VFX_LIMIT?'disabled':''}>${art(item)}<span>${esc(item.name)}</span>${item.count>1?`<small>${item.count}</small>`:''}</button>`).join('')}</div></section>`;}).join('')||'<div class="vfx-empty">No results</div>';
   for(const node of popup.querySelectorAll('[data-preview]:not(.has-preview)'))requestEffectPreview(mode,node.dataset.preview,url=>{if(!node.isConnected)return;node.classList.add('has-preview');node.innerHTML=`<img alt="" src="${url}">`;});};
  popup.querySelector('input').addEventListener('input',draw);popup.addEventListener('click',event=>{const tab=event.target.closest('[data-catalog-mode]');if(tab){if(tab.dataset.catalogMode!==mode)this.openPopup(anchor,tab.dataset.catalogMode);return;}const button=event.target.closest('[data-choice]');if(!button||button.disabled)return;this.run(()=>this.addChoice(mode,button.dataset.choice));});
  popup.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){this.closePopup();anchor.focus();}if(event.key==='ArrowDown'&&event.target.tagName==='INPUT'){event.preventDefault();popup.querySelector('button:not(:disabled)')?.focus();}});draw();
  // Measure the populated catalogue once so searching keeps the input stationary.
  const panel=this.root.getBoundingClientRect(),from=anchor.getBoundingClientRect();popup.style.width=Math.max(260,panel.width-16)+'px';const size=popup.getBoundingClientRect();
  popup.style.left=Math.max(8,Math.min(panel.left+8,innerWidth-size.width-8))+'px';
  popup.style.top=Math.max(8,Math.min(from.bottom+6,innerHeight-size.height-8))+'px';
  popup.querySelector('input').focus();
 }
 destroy(){this.closeColor?.();this.closePopup();this.controls.destroy();this.abort.abort();}
}
