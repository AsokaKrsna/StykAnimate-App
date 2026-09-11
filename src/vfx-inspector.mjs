import {VFX_REGISTRY,VFX_LIMIT,vfxProperty,resolvedVfx} from './vfx.mjs';
import {effectAvailable} from './vfx-registry.mjs';
import {VFX_PRESETS} from './vfx-presets.mjs';
import {vfxPaint} from './vfx-paint.mjs';
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
 constructor({editor,root,properties,beforeEdit,onChange,onError,context=()=>''}){
  Object.assign(this,{editor,root,properties,beforeEdit,onChange,onError,context});
  this.scope='selection';this.visible=false;this.bindings=new Map();this.collapsed=new Set();this.abort=new AbortController();this.selected=null;
  this.controls=new PropertyControls(root,{
   canHandle:key=>this.bindings.has(key),
   getValue:key=>this.readBinding(this.bindings.get(key)),
   begin:({key})=>{this.beforeEdit();const b=this.bindings.get(key);b.stack=structuredClone(editor.vfxEffects(b.target));editor.beginAnimationEdit(b.target,b.derived?'vfxStack':b.property,{exactTarget:true});return b;},
   preview:({key,value,token:b})=>{if(b.derived){const next=structuredClone(b.stack),effect=next.find(e=>e.id===b.id),p={...resolvedVfx(effect).params},angle=b.param==='angle'?value*Math.PI/180:Math.atan2(p.offsetY,p.offsetX),distance=b.param==='distance'?value:Math.hypot(p.offsetX,p.offsetY);Object.assign(effect.params,{offsetX:Math.max(-256,Math.min(256,Math.cos(angle)*distance)),offsetY:Math.max(-256,Math.min(256,Math.sin(angle)*distance))});editor.previewAnimationEdit(next);}else editor.previewAnimationEdit(value/b.factor);for(const input of root.querySelectorAll('input[data-property]'))if(input.dataset.property===key){input.value=value;input.style.setProperty('--vfx-progress',`${100*(value-Number(input.min))/(Number(input.max)-Number(input.min))}%`);}this.onChange();},
   commit:()=>{editor.commitAnimationEdit();this.sync();this.onChange();},cancel:()=>{editor.cancelAnimationEdit();this.sync();this.onChange();},onError:error=>this.onError(error),
  });
  const listen=(name,fn)=>root.addEventListener(name,e=>this.run(()=>fn.call(this,e)),{signal:this.abort.signal});
  listen('click',this.click);listen('change',this.change);listen('keydown',this.keydown);listen('dragstart',this.dragstart);listen('dragover',this.dragover);listen('drop',this.drop);listen('dragend',this.dragend);
  editor.addEventListener('change',({detail})=>{if(['document','selection'].includes(detail?.kind)){this.scope='selection';this.selected=null;if(detail.kind==='document')this.collapsed.clear();this.closePopup();this.sync();this.onChange();}},{signal:this.abort.signal});
 }
 readBinding(b){const p=resolvedVfx(this.editor.vfxEffects(b.target).find(e=>e.id===b.id)).params;return b.derived?(b.param==='angle'?Math.atan2(p.offsetY,p.offsetX)*180/Math.PI:Math.hypot(p.offsetX,p.offsetY)):p[b.param]*b.factor;}
 setVisible(visible){this.commit();this.visible=visible;this.root.hidden=!visible;this.properties.hidden=visible;if(!visible)this.closePopup();this.sync();this.onChange();}
 get active(){return this.controls.active;}
 commit(){this.controls.commit();}
 cancel(){this.controls.cancel();}
 run(fn){try{fn();}catch(error){this.onError(error);}}
 targets(){const e=this.editor;if(this.scope==='scene'||this.scope==='selection'&&this.context()==='scene')return [{kind:'scene'}];const objects=e.selectedObjects??[];if(!objects.length)return [];if(this.scope==='selection'&&objects.length===1&&e.selectedJoint>=0&&!e.figure?._styk?.movieclip){const segment=e.figure?.segments?.[e.selectedJoint];if(segment)return [{kind:'segment',uid:e.object.unique_id,handleId:segment.segment_id,figureTypeId:e.object.figure_type_id}];}return objects.map(o=>({kind:'figure',uid:o.unique_id}));}
 targetIcon(target){if(target?.kind==='scene')return vfxIcon('camera');if(target?.kind==='segment')return icon('nodes');const object=this.editor.evaluatedFrame?.objects.find(o=>o.unique_id===target?.uid),figure=this.editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id);return figure?._styk?.movieclip?vfxIcon('movieclip'):icon('person');}
 ownerName(target){if(target.kind==='scene')return 'Scene';const object=this.editor.evaluatedFrame.objects.find(o=>o.unique_id===target.uid),figure=this.editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id);return `${figure?.name||'Figure'}${target.kind==='segment'?` · Node ${target.handleId}`:''}`;}
 selectedEffect(){if(!this.visible||!this.selected)return null;const {target,id}=this.selected;if(!this.targets().some(t=>JSON.stringify(t)===JSON.stringify(target)))return null;const effect=this.editor.vfxEffects(target).find(e=>e.id===id);return effect?{target,effect:resolvedVfx(effect)}:null;}
 select(target,id){this.selected={target,id};for(const owner of this.targets())for(const effect of this.editor.vfxEffects(owner))this.collapsed.add(identity(owner,effect.id));this.collapsed.delete(identity(target,id));this.sync();this.onChange();}
 field(target,effect,param,d,ownerIndex,locked,derived=false){
  const property=derived?'vfxStack':vfxProperty(effect.type,effect.id,param),key=`${ownerIndex}-${effect.id}-${param}`,factor=d.unit==='%'?100:1,b={target,id:effect.id,param,property,factor,derived};this.bindings.set(key,b);
  const value=derived?this.readBinding(b):effect.params[param],label=`${VFX_REGISTRY[effect.type].name} ${d.label}`;
  if(d.type==='color')return `<div class="vfx-field"><label>${esc(d.label)}</label><button type="button" class="vfx-paint" data-vfx-paint="${key}" style="--paint:${esc(paintCSS(vfxPaint(value)))}" aria-label="${esc(label)}" title="${esc(label)}" ${locked?'disabled':''}><span></span>${icon('chevron-down')}</button></div>`;
  if(d.options)return `<div class="vfx-field"><label for="vfx-field-${key}">${esc(d.label)}</label>${d.toggle?`<button type="button" class="vfx-toggle" data-vfx-toggle="${key}" aria-label="${esc(label)}" aria-pressed="${Boolean(value)}" ${locked?'disabled':''}><i></i></button>`:`<select id="vfx-field-${key}" data-vfx-choice="${key}" aria-label="${esc(label)}" ${locked?'disabled':''}>${d.options.map((name,i)=>`<option value="${i}" ${i===value?'selected':''}>${esc(name)}</option>`).join('')}</select>`}</div>`;
  const actual=value*factor,min=d.min*factor,max=d.max*factor,step=d.step*factor;
  return `<div class="vfx-parameter"><div class="vfx-field" data-property-row="${key}"><label class="property-scrub" data-property-scrub="${key}" for="vfx-field-${key}">${esc(d.label)}</label><div class="vfx-value"><input type="number" id="vfx-field-${key}" data-property="${key}" data-property-value="${actual}" data-property-step="${step}" data-property-precision="${d.discrete?0:2}" value="${+actual.toFixed(2)}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}" ${locked?'disabled':''}>${d.unit?`<span aria-hidden="true">${esc(d.unit)}</span>`:''}</div></div>${d.discrete||max-min>10000?'':`<input class="vfx-slider" type="range" data-property="${key}" data-property-value="${actual}" data-property-step="${step}" data-property-precision="2" value="${actual}" min="${min}" max="${max}" step="${step}" style="--vfx-progress:${100*(actual-min)/(max-min)}%" aria-label="${esc(label+' slider')}" ${locked?'disabled':''}>`}</div>`;
 }
 sync(){
  if(!this.visible||this.active)return;const targets=this.targets(),e=this.editor;this.bindings.clear();
  const stacks=targets.map(target=>({target,effects:e.vfxEffects(target).map(resolvedVfx),locked:e.getLayer(target.kind==='scene'?'scene':e.layerForUid(target.uid))?.locked}));
  const body=stacks.map(({target,effects,locked},ownerIndex)=>`${targets.length>1?`<h3 class="vfx-owner-name">${this.targetIcon(target)}${esc(this.ownerName(target))}</h3>`:''}${effects.map((effect,index)=>{
   const definition=VFX_REGISTRY[effect.type],owner=JSON.stringify(target),id=effect.id,selected=this.selected&&identity(target,id)===identity(this.selected.target,this.selected.id),collapsed=this.collapsed.has(identity(target,id));
   const fields=Object.entries(definition.params).filter(([,d])=>!d.when||Object.entries(d.when).every(([key,values])=>values.includes(effect.params[key])));
   const render=entries=>entries.map(([param,d])=>this.field(target,effect,param,d,ownerIndex,locked)).join('');
   const normal=render(fields.filter(([,d])=>!d.advanced)),advanced=render(fields.filter(([,d])=>d.advanced));
   const shadow=effect.type==='shadow'?['angle','distance'].map(param=>this.field(target,effect,param,{label:param==='angle'?'Angle':'Distance',type:'number',min:param==='angle'?-180:0,max:param==='angle'?180:256,step:1,unit:param==='angle'?'°':'px'},ownerIndex,locked,true)).join(''):'';
   const action=(name,label,disabled=false)=>`<button type="button" data-vfx-action="${name}" title="${esc(label)}" aria-label="${esc(definition.name+' '+label.toLowerCase())}" ${locked||disabled?'disabled':''}>${icon(actionIcons[name])}<span>${label}</span></button>`;
   return `<section class="vfx-effect${effect.enabled?'':' is-disabled'}${selected?' is-selected':''}" data-section="vfx-${ownerIndex}-${id}" data-vfx-id="${id}" data-vfx-target="${esc(owner)}"><div class="vfx-effect-header"><button type="button" class="vfx-grip" draggable="${!locked}" data-vfx-drag title="Drag to reorder · Alt+↑/↓" aria-label="Reorder ${esc(definition.name)}" ${locked?'disabled':''}>${vfxIcon('grip')}</button><button type="button" class="vfx-disclosure" data-vfx-action="collapse" aria-label="${collapsed?'Expand':'Collapse'} ${esc(definition.name)}" aria-expanded="${!collapsed}">${icon(collapsed?'chevron-right':'chevron-down')}</button><button type="button" class="vfx-effect-title" data-vfx-action="select" aria-pressed="${Boolean(selected)}">${vfxIcon(definition.icon)}<span>${esc(definition.name)}</span></button><button type="button" class="vfx-enable" data-vfx-action="enable" title="${effect.enabled?'Disable':'Enable'} effect" aria-label="Enable ${esc(definition.name)}" aria-pressed="${effect.enabled}" ${locked?'disabled':''}>${icon(effect.enabled?'eye':'eye-off')}</button><details class="vfx-menu"><summary aria-label="${esc(definition.name)} actions">${icon('more')}</summary><div>${action('up','Move up',!index)}${action('down','Move down',index===effects.length-1)}${action('copy','Copy')}${action('duplicate','Duplicate',effects.length>=VFX_LIMIT)}${action('reset','Reset')}${action('remove','Remove')}</div></details></div><div class="vfx-effect-body" ${collapsed?'hidden':''}>${normal}${shadow}${advanced?`<details class="vfx-advanced"><summary>More</summary>${advanced}</details>`:''}<div class="vfx-quick">${action('duplicate','Duplicate',effects.length>=VFX_LIMIT)}${action('reset','Reset')}${action('remove','Remove')}</div></div></section>`;
  }).join('')}`).join('');
  const disabled=!targets.length||stacks.some(s=>s.locked||s.effects.length>=VFX_LIMIT);
  updateInspectorDOM(this.root,`<div class="vfx-toolbar"><div class="vfx-target">${this.targetIcon(targets[0])}<select id="vfx-scope" aria-label="Effect target"><option value="selection" ${this.scope==='selection'?'selected':''}>${esc(this.scope==='selection'&&targets.length===1?this.ownerName(targets[0]):'Selection')}</option><option value="figure" ${this.scope==='figure'?'selected':''}>Whole figure</option><option value="scene" ${this.scope==='scene'?'selected':''}>Scene</option></select></div><button type="button" data-vfx-action="presets" title="Presets" aria-label="Effect presets" ${disabled?'disabled':''}>${vfxIcon('effects')}</button>${this.clipboard?`<button type="button" data-vfx-action="paste" title="Paste effect" aria-label="Paste effect" ${disabled?'disabled':''}>${icon('duplicate')}</button>`:''}</div><div class="vfx-stack">${body||`<div class="vfx-empty">${vfxIcon('effects')}<span>${targets.length?'No effects':'Select a figure or node'}</span></div>`}</div><div class="vfx-add"><button type="button" data-vfx-action="add" ${disabled?'disabled':''}>${icon('plus')} Add effect</button></div>`,{preserveDisclosure:true});
 }
 click(event){
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.vfxPaint){const b=this.bindings.get(button.dataset.vfxPaint),effect=resolvedVfx(this.editor.vfxEffects(b.target).find(e=>e.id===b.id));this.commit();this.beforeEdit();this.select(b.target,b.id);this.closeColor?.();this.closeColor=openColorPicker({anchor:button,paint:vfxPaint(effect.params[b.param]),gradients:true,alpha:true,onChange:paint=>{this.editor.setVfxParameter(b.target,b.id,b.param,paint);this.sync();this.onChange();}});return;}
  if(button.dataset.vfxToggle){const b=this.bindings.get(button.dataset.vfxToggle);this.commit();this.beforeEdit();this.editor.setVfxParameter(b.target,b.id,b.param,Number(button.getAttribute('aria-pressed')!=='true'));this.sync();this.onChange();return;}
  const action=button.dataset.vfxAction,row=button.closest('[data-vfx-id]');if(!action)return;
  const target=row?JSON.parse(row.dataset.vfxTarget):null,id=row?.dataset.vfxId;
  if(action==='select'){this.select(target,id);return;}
  if(action==='collapse'){const key=identity(target,id);this.collapsed.has(key)?this.collapsed.delete(key):this.collapsed.add(key);this.sync();return;}
  if(action==='add'||action==='presets'){this.commit();this.openPopup(button,action);return;}
  if(action==='copy'){this.clipboard=structuredClone([this.editor.vfxEffects(target).find(e=>e.id===id)]);this.sync();return;}
  this.commit();this.beforeEdit();
  if(action==='paste')this.editor.pasteVfx(this.targets(),this.clipboard);
  if(action==='enable'){const effect=this.editor.vfxEffects(target).find(e=>e.id===id);this.editor.setVfxParameter(target,id,'enabled',Number(!effect.enabled));}
  if(action==='remove'){this.editor.removeVfx(target,id);if(this.selected?.id===id)this.selected=null;}
  if(action==='duplicate')this.select(target,this.editor.duplicateVfx(target,id));
  if(action==='reset')this.editor.resetVfx(target,id);
  if(action==='up'||action==='down')this.editor.moveVfx(target,id,action==='up'?-1:1);
  for(const menu of this.root.querySelectorAll('.vfx-menu'))menu.open=false;this.sync();this.onChange();
 }
 change(event){const input=event.target;if(input.id==='vfx-scope'){const scope=input.value;this.commit();this.scope=scope;this.selected=null;this.closePopup();this.sync();this.onChange();}else if(input.dataset.vfxChoice){const b=this.bindings.get(input.dataset.vfxChoice);this.commit();this.beforeEdit();this.editor.setVfxParameter(b.target,b.id,b.param,Number(input.value));this.sync();this.onChange();}}
 keydown(event){if(event.key==='Escape'){this.closePopup();this.selected=null;for(const menu of this.root.querySelectorAll('.vfx-menu'))menu.open=false;this.sync();this.onChange();}if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)&&event.target.closest('[data-vfx-drag]')){event.preventDefault();const row=event.target.closest('[data-vfx-id]');this.commit();this.beforeEdit();this.editor.moveVfx(JSON.parse(row.dataset.vfxTarget),row.dataset.vfxId,event.key==='ArrowUp'?-1:1);this.sync();this.onChange();}}
 dragstart(event){const grip=event.target.closest('[data-vfx-drag]');if(!grip){event.preventDefault();return;}const row=grip.closest('[data-vfx-id]');this.dragged={target:row.dataset.vfxTarget,id:row.dataset.vfxId};event.dataTransfer.setData('application/x-styk-vfx',JSON.stringify(this.dragged));event.dataTransfer.effectAllowed='move';row.classList.add('is-dragging');}
 dragover(event){const row=event.target.closest('[data-vfx-id]');if(!this.dragged||row?.dataset.vfxTarget!==this.dragged.target)return;event.preventDefault();event.dataTransfer.dropEffect='move';for(const item of this.root.querySelectorAll('.is-drop-target'))item.classList.remove('is-drop-target');row.classList.add('is-drop-target');}
 drop(event){const row=event.target.closest('[data-vfx-id]');if(!this.dragged||row?.dataset.vfxTarget!==this.dragged.target)return;event.preventDefault();const target=JSON.parse(this.dragged.target),index=this.editor.vfxEffects(target).findIndex(e=>e.id===row.dataset.vfxId);this.commit();this.beforeEdit();this.editor.reorderVfx(target,this.dragged.id,index);this.dragend();this.sync();this.onChange();}
 dragend(){this.dragged=null;for(const row of this.root.querySelectorAll('.is-dragging,.is-drop-target'))row.classList.remove('is-dragging','is-drop-target');}
 closePopup(){this.popup?.remove();this.popup=null;}
 openPopup(anchor,mode){
  this.closePopup();const scene=this.targets()[0]?.kind==='scene',popup=this.popup=document.createElement('div');popup.className='vfx-catalog';popup.setAttribute('popover','auto');popup.setAttribute('role','dialog');popup.setAttribute('aria-label',mode==='presets'?'VFX presets':'Add effect');
  popup.innerHTML=`<div class="vfx-catalog-search">${icon('search')}<input type="search" placeholder="${mode==='presets'?'Search presets':'Search effects'}" aria-label="Search ${mode==='presets'?'presets':'effects'}"></div><div class="vfx-catalog-results"></div>`;document.body.append(popup);popup.showPopover();
  const available=mode==='presets'?Object.entries(VFX_PRESETS).filter(([,p])=>p.effects.every(([type])=>effectAvailable(type,scene))).map(([name,p])=>({key:name,name,icon:p.icon,category:'Presets',count:p.effects.length})):Object.entries(VFX_REGISTRY).filter(([type])=>effectAvailable(type,scene)).map(([key,d])=>({key,...d,count:1}));
  const draw=()=>{const query=popup.querySelector('input').value.toLowerCase(),items=available.filter(item=>(item.name+' '+item.category).toLowerCase().includes(query));popup.querySelector('.vfx-catalog-results').innerHTML=[...new Set(items.map(i=>i.category))].map(category=>`<section><h3>${esc(category)}</h3><div class="vfx-catalog-grid">${items.filter(i=>i.category===category).map(item=>`<button type="button" class="vfx-catalog-card" data-choice="${esc(item.key)}" ${this.targets().some(t=>this.editor.vfxEffects(t).length+item.count>VFX_LIMIT)?'disabled':''}><span class="vfx-catalog-art vfx-art-${item.icon}">${vfxIcon(item.icon)}</span><span>${esc(item.name)}</span></button>`).join('')}</div></section>`).join('')||'<div class="vfx-empty">No results</div>';};
  popup.querySelector('input').addEventListener('input',draw);popup.addEventListener('click',event=>{const button=event.target.closest('[data-choice]');if(!button||button.disabled)return;this.run(()=>{this.beforeEdit();const targets=this.targets();if(mode==='presets'){this.editor.applyVfxPreset(targets,button.dataset.choice);this.select(targets[0],this.editor.vfxEffects(targets[0]).at(-1).id);}else{const ids=this.editor.addVfx(targets,button.dataset.choice);this.select(targets[0],ids[0]);}this.closePopup();this.sync();this.onChange();});});
  popup.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){this.closePopup();anchor.focus();}if(event.key==='ArrowDown'&&event.target.tagName==='INPUT'){event.preventDefault();popup.querySelector('button:not(:disabled)')?.focus();}});draw();
  // Measure the populated catalogue once so searching keeps the input stationary.
  const panel=this.root.getBoundingClientRect(),size=popup.getBoundingClientRect();
  popup.style.left=Math.max(8,Math.min(panel.left+(panel.width-size.width)/2,innerWidth-size.width-8))+'px';
  popup.style.top=Math.max(8,Math.min(panel.top+(panel.height-size.height)/2,innerHeight-size.height-8))+'px';
  popup.querySelector('input').focus();
 }
 destroy(){this.closeColor?.();this.closePopup();this.controls.destroy();this.abort.abort();}
}
