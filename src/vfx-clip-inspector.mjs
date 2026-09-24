import {vfxClipActiveAt,clipTime} from './vfx-clips.mjs';
import {VFX_REGISTRY,vfxDescriptor} from './vfx.mjs';
import {icon} from './icons.mjs';
import {vfxIcon} from './vfx-icons.mjs';
import {vfxVisibleKeys,vfxSelectedChannels,vfxChannelLabel,setVfxVisibleChannels,vfxGroupEffectName} from './vfx-key-channels.mjs';
import {openVfxChannelMenu} from './vfx-key-channel-menu.mjs';
import {clipNumber,editGroupEffect,openGroupMenu} from './vfx-clip-controls.mjs';
import {generatorClipActiveAt} from './vfx-generators.mjs';
import {isGeneratorType} from './vfx-registry.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clipName=c=>c.name||VFX_REGISTRY[c.effects[0]?.type]?.name||'Effects';
const action=(name,label,content=label,disabled=false)=>`<button type="button" data-clip-action="${name}" aria-label="${esc(label)}" title="${esc(label)}" ${disabled?'disabled':''}>${content}</button>`;
const keyIndex=(clip,keys,tick)=>{let low=0,high=keys.length-1,time=clipTime(clip,tick);while(low<high){const mid=(low+high+1)>>>1;if(keys[mid].tick<=time)low=mid;else high=mid-1;}return low;};
const currentKey=(clip,keys,tick)=>keys[keyIndex(clip,keys,tick)];
// Generated clips stay listed while their particles are still visible.
export const filterVfxClips=(clips,{view='playhead',tick=0,selected=null,query=''}={})=>clips.filter(c=>
 (view==='all'||(view==='selected'?c.id===selected:vfxClipActiveAt(c,tick)||generatorClipActiveAt(c,tick)))&&(!query||view!=='all'||clipName(c).toLowerCase().includes(query.toLowerCase())));

/** A beam aims at a stage point or locks onto a node picked on the stage. */
function aimLabel(editor,p){
 const object=editor.evaluatedFrame?.objects.find(o=>o.unique_id===p.aimUid),figure=object&&editor.report.figure_types?.find(f=>f.figure_type_id===object.figure_type_id);
 return `${figure?.name||`Figure ${p.aimUid}`} · ${p.aimHandle?`node ${p.aimHandle}`:'origin'}`;
}
function aimRow(host,clip,effect,locked){
 if(effect.type!=='beam')return '';
 const e=host.editor,p=effect.params,picking=e._vfxAimPick?.clip===clip.id&&e._vfxAimPick.effect===effect.id,label=p.aimUid?aimLabel(e,p):'Point on stage';
 const hint=clip.target.kind==='figure'?'<p class="vfx-aim-hint">Fires from the figure’s origin. To fire from a hand, select that node before adding the beam.</p>':'';
 return hint+`<div class="vfx-field vfx-aim"><label>Aim at</label><span class="vfx-aim-target" title="${esc(label)}">${esc(label)}</span><button type="button" class="vfx-aim-pick" data-clip-action="aim-pick" data-effect-id="${effect.id}" aria-pressed="${picking}" title="Click a node, a figure origin or any point on the stage" ${locked?'disabled':''}>${picking?'Click the stage…':'Pick'}</button>${p.aimUid?`<button type="button" data-clip-action="aim-clear" data-effect-id="${effect.id}" aria-label="Aim at a stage point instead" title="Aim at a stage point instead" ${locked?'disabled':''}>${icon('close')}</button>`:''}</div>`;
}
function effectFields(host,clip,effect,locked,picked){
 const scene=clip.target.kind==='scene';
 const fields=Object.entries(VFX_REGISTRY[effect.type].params).filter(([,d])=>!d.hidden&&(!d.sceneOnly||scene)&&(!d.when||Object.entries(d.when).every(([key,values])=>values.includes(effect.params[key])))).map(([param,d])=>[param,param==='effectStrength'&&clip.effects.length>1?{...d,advanced:true}:d]).sort(([a],[b])=>(a==='effectStrength')-(b==='effectStrength'));
 const render=entries=>entries.map(([param,d])=>{
  const field=host.field(clip.target,effect,param,d,`clip-${clip.id}`,locked),key=`clip-${clip.id}-${effect.id}-${param}`,b=host.bindings.get(key),keys=clip.keys[b.property]??[];
  const on=currentKey(clip,keys,host.editor.tick)?.tick===Math.floor(clipTime(clip,host.editor.tick));
  return `<div class="vfx-key-field${picked.length===1&&picked[0]===b.property?' is-channel-selected':''}" data-vfx-binding="${esc(key)}">${field}<button class="vfx-key${keys.length?' is-animated':''}${on?' is-keyed':''}" type="button" data-clip-key="${esc(key)}" aria-label="${on?'Remove':'Add'} ${esc(d.label)} key" title="${on?'Remove key':'Add key'}" ${locked?'disabled':''}>${icon('diamond')}</button></div>`;
 }).join('');
 // Generated effects can draw a new random pattern with the same settings.
 const shuffle=isGeneratorType(effect.type)?`<div class="vfx-field vfx-variation"><label>Variation</label><button type="button" data-clip-action="shuffle" data-effect-id="${effect.id}" title="Same settings, new random pattern" ${locked?'disabled':''}>${vfxIcon('dice')}<span>Shuffle</span></button></div>`:'';
 const normal=aimRow(host,clip,effect,locked)+render(fields.filter(([,d])=>!d.advanced))+shuffle,advanced=render(fields.filter(([,d])=>d.advanced));
 return normal+(advanced?`<details class="vfx-advanced"><summary>More</summary>${advanced}</details>`:'');
}
function keyNavigation(host,c,locked){
 const e=host.editor,selected=vfxSelectedChannels(e,c);
 if(!selected.length&&!Object.keys(c.keys).length)return '<div class="vfx-key-navigation" hidden></div>';
 const channels=Object.entries(vfxVisibleKeys(e,c)),time=clipTime(c,e.tick);let previous,next;
 for(const [,keys] of channels){const index=keyIndex(c,keys,e.tick),a=keys[index]?.tick<time?keys[index]:keys[index-1],b=keys[index]?.tick>time?keys[index]:keys[index+1];if(a&&(!previous||a.tick>previous.tick))previous=a;if(b&&(!next||b.tick<next.tick))next=b;}
 const seek=(key,label,iconName)=>`<button type="button" ${key?`data-clip-seek="${Math.max(0,key.tick+c.start-c.offset)}"`:'disabled'} aria-label="${label}" title="${label}">${icon(iconName)}</button>`;
 const property=selected.length===1?selected[0]:null,keys=c.keys[property]??[],current=currentKey(c,keys,e.tick),on=current?.tick===Math.floor(time),d=property&&vfxDescriptor(property);
 return `<div class="vfx-key-navigation"><button type="button" class="vfx-channel-trigger" data-clip-action="channels" aria-label="Visible effect keys" aria-haspopup="dialog" title="${esc(vfxChannelLabel(e,c))}">${icon('sliders')}<span>${esc(vfxChannelLabel(e,c))}</span>${icon('chevron-down')}</button>${seek(previous,'Previous effect key','chevron-left')}${property?`<button class="vfx-key${keys.length?' is-animated':''}${on?' is-keyed':''}" type="button" data-clip-key-property="${esc(property)}" aria-label="${on?'Remove':'Add'} selected value key" title="${on?'Remove':'Add'} key" ${locked?'disabled':''}>${icon('diamond')}</button>`:''}${seek(next,'Next effect key','chevron-right')}${property?`<select data-clip-easing="${esc(property)}" aria-label="${esc(d.label)} easing" ${locked||!current?'disabled':''}>${(d.discrete?['constant']:['linear','auto','ease-in','ease-out','constant']).map(mode=>`<option ${current?.interpolation===mode?'selected':''}>${mode}</option>`).join('')}</select>`:''}</div>`;
}
export function clipKeyControls(host){const clip=host.renderedVfxClip;if(!clip)return '';const e=host.editor,locked=e.getLayer(clip.target.kind==='scene'?'scene':e.layerForUid(clip.target.uid))?.locked;return keyNavigation(host,clip,locked);}
function clipBody(host,c,locked){
 const e=host.editor;
 const number=(key,label,value,min=0,max=10000000)=>clipNumber(host,c,key,label,value,min,max,locked);
 let body=`<div class="vfx-clip-row"><span>Plays</span><select data-clip-field="mode" aria-label="Effect duration" ${locked?'disabled':''}><option value="always" ${c.duration===null?'selected':''}>Whole animation</option><option value="timed" ${c.duration!==null?'selected':''}>Frame range</option></select></div>${c.duration===null?'':`<div class="vfx-clip-timing">${number('start','Start',c.start+1,1,10000001-c.duration)+number('duration','Duration',c.duration,1,10000000-c.start)}</div>`}`;
 body+=`<div class="vfx-clip-envelope">${c.effects.length>1||c.strength!==1?number('strength','Strength',c.strength*100,0,100):''}</div>`;
 const effects=e.sampleVfxClip(c.id),picked=vfxSelectedChannels(e,c),expanded=new Set([...host.root.querySelectorAll('.vfx-clip-effect[open]')].map(node=>node.dataset.groupEffect));host.renderingClip=c.id;
 // A group shows its selected effect open the first time it is displayed.
 host.shownGroups??=new Set();if(!host.shownGroups.has(c.id)){host.shownGroups.add(c.id);expanded.add(host.selectedClipEffect??effects[0]?.id);}
 try{
  body+=effects.map((effect,index)=>{
   const fields=effectFields(host,c,effect,locked,picked);
   if(effects.length===1)return `<div class="vfx-clip-effect" data-section="clip-effect-${effect.id}">${fields}</div>`;
   return `<details class="vfx-clip-effect${host.selectedClipEffect===effect.id?' is-effect-selected':''}" data-section="clip-effect-${effect.id}" data-group-effect="${effect.id}" name="vfx-effects-${c.id}" ${expanded.has(effect.id)?'open':''}><summary><button type="button" data-vfx-group-drag draggable="${!locked}" aria-label="Reorder ${esc(vfxGroupEffectName(c,effect))}" title="Drag to reorder · Alt+↑/↓" ${locked?'disabled':''}>${vfxIcon('grip')}</button>${vfxIcon(effect.type)}<span>${esc(vfxGroupEffectName(c,effect))}</span><span class="vfx-group-actions">${action('effect-menu','Effect actions',icon('more'),locked)}</span>${icon('chevron-right')}</summary>${fields}</details>`;
  }).join('');
 }finally{host.renderingClip=null;}

 body+=`<div class="vfx-clip-footer vfx-group-add">${action('group-add','Add to group',icon('plus')+`<span>${c.effects.length>1?'Add to group':'Combine with another effect'}</span>`,locked)}</div>`;
 return body;
}
export function clipInspectorHTML(host,targets,{legacyCount=0,legacyVisible=false}={}){
 host.renderedVfxClip=null;
 if(!targets.length)return '<div class="ds-empty vfx-empty-state"><strong>Select a figure to add effects</strong></div>';
 const e=host.editor,clips=targets.flatMap(t=>e.getVfxClips(t)),view=host.clipView??'playhead',query=(host.clipQuery??'').toLowerCase();
 const visible=filterVfxClips(clips,{view,tick:e.tick,selected:host.selectedClip,query});
 host.renderedVfxClip=visible.find(c=>c.id===host.selectedClip)??null;
 const rows=visible.map(c=>{
  const locked=e.getLayer(c.target.kind==='scene'?'scene':e.layerForUid(c.target.uid))?.locked,selected=c.id===host.selectedClip;
  return `<section class="vfx-clip${selected?' is-selected':''}${c.enabled?'':' is-disabled'}" data-section="clip-${c.id}" data-clip-id="${c.id}"><div class="vfx-clip-header">${action('select',clipName(c),`${icon(selected?'chevron-down':'chevron-right')}${vfxIcon(c.effects.length>1?'effects':c.effects[0]?.type)}<span>${esc(clipName(c))}</span>`)}${c.duration===null?'':`<span class="vfx-clip-range" title="Plays on frames ${c.start+1}–${c.start+c.duration}">${c.start+1}–${c.start+c.duration}</span>`}${action('enabled',c.enabled?'Disable clip':'Enable clip',icon(c.enabled?'eye':'eye-off'),locked)}<details class="vfx-menu"><summary aria-label="Effect clip actions">${icon('more')}</summary><div>${action('rename','Rename',undefined,locked)}${action('up','Move up',undefined,locked)}${action('down','Move down',undefined,locked)}${action('copy','Copy animation')}${action('duplicate','Duplicate',undefined,locked)}${action('delete','Delete',undefined,locked)}</div></details></div>${selected?`<div class="vfx-clip-body">${clipBody(host,c,locked)}</div>`:''}</section>`;
 }).join('');
 const locked=targets.some(t=>e.getLayer(t.kind==='scene'?'scene':e.layerForUid(t.uid))?.locked);
 return `<div class="vfx-clip-filter"><select data-clip-view aria-label="Show effects"><option value="playhead" ${view==='playhead'?'selected':''}>At this frame</option><option value="selected" ${view==='selected'?'selected':''}>Selected</option><option value="all" ${view==='all'?'selected':''}>All (${clips.length+legacyCount})</option></select>${e._vfxClipClipboard?action('paste','Paste animation',icon('duplicate')):''}</div>${view==='all'?`<input class="vfx-clip-search" type="search" data-clip-search placeholder="Search effects" aria-label="Search effect clips" value="${esc(host.clipQuery??'')}">`:''}${rows||(legacyVisible?'':host.emptyHTML(clips.length+legacyCount,view,locked))}`;
}
export function selectClip(host,id){
 host.commit();host.selectedClip=id;host.selected=null;host.selectedClipEffect=host.editor.getVfxClips().find(c=>c.id===id)?.effects[0]?.id??null;host.editor._selectedVfxClip=id;host.editor._selectedVfxKey=null;
 host.editor._emit('vfx-selection');host.sync();host.onChange();
}
function renameClip(host,row,c){
 const input=document.createElement('input');input.className='vfx-clip-rename';input.value=clipName(c);input.maxLength=120;input.setAttribute('aria-label','Effect name');
 row.querySelector('.vfx-clip-header').append(input);input.focus();input.select();let done=false;
 const finish=save=>{if(done)return;done=true;if(save)host.run(()=>host.editor.setVfxClip(c.id,{name:input.value.trim()}));input.remove();host.sync();};
 input.addEventListener('blur',()=>finish(true));input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter')finish(true);if(event.key==='Escape')finish(false);});
}
export function clipClick(host,event){
 const e=host.editor,button=event.target.closest('button'),row=event.target.closest('[data-clip-id]'),id=row?.dataset.clipId??host.renderedVfxClip?.id;
 if(!button){const summary=event.target.closest('.vfx-clip-effect>summary');if(summary){host.selectedClipEffect=summary.closest('[data-group-effect]').dataset.groupEffect;host.sync();host.onChange();return true;}return false;}
 if(button.disabled)return false;
 if(button.hasAttribute('data-vfx-group-drag')){event.preventDefault();return true;}
 if(button.dataset.clipKeyProperty){host.commit();e.toggleVfxClipKey(id,button.dataset.clipKeyProperty);host.sync();host.onChange();return true;}
 if(button.dataset.clipKey){host.commit();const b=host.bindings.get(button.dataset.clipKey);e.toggleVfxClipKey(b.clip,b.property);const clip=e.getVfxClips().find(c=>c.id===b.clip);if(clip.keys[b.property]?.length)setVfxVisibleChannels(e,clip,[b.property]);host.sync();host.onChange();return true;}
 if(button.dataset.clipSeek!==undefined){e.seek(Number(button.dataset.clipSeek),{allowBeyondEnd:true});host.sync();return true;}
 const operation=button.dataset.clipAction;if(!operation)return false;
 host.commit();host.beforeEdit();const c=id&&e.getVfxClips().find(c=>c.id===id);
 if(operation==='channels'){openVfxChannelMenu(e,c,button,{signal:host.abort.signal});return true;}
 if(operation==='shuffle'){const effect=c.effects.find(x=>x.id===button.dataset.effectId),seed=effect?.params.seed??1;e.setVfxClipParameters(id,button.dataset.effectId,{seed:1+(seed+Math.floor(Math.random()*65533))%65535});host.sync();host.onChange();return true;}
 if(operation==='aim-pick'){const effect=button.dataset.effectId,active=e._vfxAimPick?.clip===id&&e._vfxAimPick.effect===effect;e._vfxAimPick=active?null:{clip:id,effect};host.sync();host.onChange();return true;}
 if(operation==='aim-clear'){
  // Unlock in place: the stage point starts where the locked node is now.
  e._vfxAimPick=null;const p=c.effects.find(x=>x.id===button.dataset.effectId)?.params??{},g=[...(e.geometry?.objects?.values()??[])].find(g=>g?.obj?.unique_id===p.aimUid),at=g&&(p.aimHandle?g.joints?.get(p.aimHandle):g.root);
  e.setVfxClipParameters(id,button.dataset.effectId,{aimUid:0,aimHandle:0,...(at?{aimX:Math.max(-1,Math.min(2,at.x/e.report.canvas_width)),aimY:Math.max(-1,Math.min(2,at.y/e.report.canvas_height))}:{})});host.sync();host.onChange();return true;
 }
 if(operation==='select'){selectClip(host,host.selectedClip===id?null:id);return true;}
 if(operation.startsWith('effect-')){
  event.preventDefault();const effectId=button.closest('[data-group-effect]').dataset.groupEffect;
  if(operation==='effect-menu')openGroupMenu(host,c,effectId,button);else editGroupEffect(host,c,effectId,operation);return true;
 }
 if(operation==='enabled')e.setVfxClip(id,{enabled:!c.enabled});
 if(operation==='delete'){e.deleteVfxClip(id);if(id===host.selectedClip)selectClip(host,null);}
 if(operation==='copy')e.copyVfxClip(id);
 if(operation==='paste')e.movieclipBatch('Paste effect animation',()=>{for(const target of host.targets())selectClip(host,e.pasteVfxClip(target));});
 if(operation==='duplicate')selectClip(host,e.duplicateVfxClip(id));
 if(operation==='up'||operation==='down')e.moveVfxClipOrder(id,operation==='up'?-1:1);
 if(operation==='group-add'){host.addToGroup=id;host.openPopup(button,'add');return true;}
 if(operation==='rename'){renameClip(host,row,c);return true;}
 host.sync();host.onChange();return true;
}
export function clipChange(host,event){
 const input=event.target,e=host.editor,id=input.closest('[data-clip-id]')?.dataset.clipId??host.renderedVfxClip?.id;
 if(input.hasAttribute('data-clip-view')){host.clipView=input.value;host.sync();return true;}
 if(input.hasAttribute('data-clip-search')){host.clipQuery=input.value;host.sync();return true;}
 if(input.dataset.clipEasing){const c=e.getVfxClips().find(c=>c.id===id),property=input.dataset.clipEasing,selected=currentKey(c,c.keys[property],e.tick);e.setVfxClipEasing(id,property,selected.tick,vfxDescriptor(property).discrete?'constant':input.value);host.sync();return true;}
 const key=input.dataset.clipField;if(!key)return false;host.commit();host.beforeEdit();
 if(key==='mode')e.setVfxClip(id,input.value==='always'?{duration:null,start:0,offset:0}:{start:Math.floor(e.tick),duration:Math.max(1,Math.min(24,e.totalTicks-Math.floor(e.tick))),offset:0});
 else e.setVfxClip(id,{[key]:key==='includeAttached'?input.checked:key==='strength'?Number(input.value)/100:key==='start'?Number(input.value)-1:Number(input.value)});
 host.sync();host.onChange();return true;
}
