import {setVfxVisibleChannels} from './vfx-key-channels.mjs';
import {vfxDescriptor} from './vfx.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';

export function focusClipBinding(host,binding){
 if(!binding?.clip||binding.clipField)return;
 const clip=host.editor.getVfxClips().find(c=>c.id===binding.clip);if(!clip)return;
 host.selectedClipEffect=binding.id;
 setVfxVisibleChannels(host.editor,clip,[binding.property]);
 host.sync();host.onChange();
}

/** Timing and strength use the same gesture/undo owner as effect values. */
export function clipNumber(host,clip,field,label,value,min,max,locked){
 const key=`clip-${clip.id}-${field}`;
 host.bindings.set(key,{clip:clip.id,clipField:field,factor:field==='strength'?100:1,offset:field==='start'?1:0});
 return `<label data-property-row="${key}"><span class="property-scrub" data-property-scrub="${key}">${label}</span><input type="number" data-clip-field="${field}" data-property="${key}" data-property-scrub="${key}" data-property-value="${value}" data-property-step="1" data-property-precision="${field==='strength'?2:0}" aria-label="${label}" value="${value}" min="${min}" max="${max}" step="1" ${locked?'disabled':''}></label>`;
}

export function editGroupEffect(host,clip,id,operation){
 host.commit();host.beforeEdit();const index=clip.effects.findIndex(e=>e.id===id);
 if(operation==='effect-delete'){const keys={...clip.keys};for(const key of Object.keys(keys))if(vfxDescriptor(key).id===id)delete keys[key];host.editor.setVfxClip(clip.id,{effects:clip.effects.filter(e=>e.id!==id),keys});}
 else if(operation==='effect-enable')host.editor.setVfxClipParameter(clip.id,id,'enabled',Number(!host.editor.sampleVfxClip(clip.id).find(e=>e.id===id).enabled));
 else host.editor.reorderVfxGroupEffect(clip.id,id,index+(operation==='effect-up'?-1:1));
 host.sync();host.onChange();
}
export function openGroupMenu(host,clip,id,anchor){
 let menu=host.groupMenu;
 if(!menu){menu=host.groupMenu={editor:host.editor,_run:fn=>host.run(fn)};host.abort.signal.addEventListener('abort',()=>{menu.menuEvents?.abort();menu.menu?.remove();},{once:true});}
 menu.scroll=anchor;const index=clip.effects.findIndex(e=>e.id===id),action=operation=>()=>editGroupEffect(host,clip,id,operation);
 showTimelineMenu(menu,{currentTarget:anchor},[
  [{label:'Enabled',symbol:'eye',checked:host.editor.sampleVfxClip(clip.id).find(e=>e.id===id).enabled,action:action('effect-enable')}],
  [index>0&&{label:'Move up',symbol:'chevron-up',action:action('effect-up')},index<clip.effects.length-1&&{label:'Move down',symbol:'chevron-down',action:action('effect-down')}],
  [{label:'Remove',symbol:'trash',danger:true,action:action('effect-delete')}],
 ]);
}

const groupRow=target=>target.closest('[data-group-effect]');
export function groupDragStart(host,event){
 const grip=event.target.closest('[data-vfx-group-drag]');if(!grip)return false;
 if(grip.disabled){event.preventDefault();return true;}
 const row=groupRow(grip);host.commit();host.groupDrag={clip:row.closest('[data-clip-id]').dataset.clipId,id:row.dataset.groupEffect};
 event.stopPropagation();event.dataTransfer.setData('application/x-styk-vfx-group',JSON.stringify(host.groupDrag));event.dataTransfer.effectAllowed='move';row.classList.add('is-dragging');return true;
}
export function groupDragOver(host,event){
 if(!host.groupDrag)return false;
 const row=groupRow(event.target);if(!row||row.closest('[data-clip-id]').dataset.clipId!==host.groupDrag.clip)return true;
 event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
 for(const node of host.root.querySelectorAll('.is-drop-target'))node.classList.remove('is-drop-target');row.classList.add('is-drop-target');return true;
}
export function groupDragEnd(host){host.groupDrag=null;for(const node of host.root.querySelectorAll('.is-dragging,.is-drop-target'))node.classList.remove('is-dragging','is-drop-target');}
export function groupDrop(host,event){
 if(!host.groupDrag)return false;
 const drag=host.groupDrag,row=groupRow(event.target);groupDragEnd(host);event.preventDefault();event.stopPropagation();
 if(row?.closest('[data-clip-id]').dataset.clipId!==drag.clip)return true;
 const clip=host.editor.getVfxClips().find(c=>c.id===drag.clip),index=clip.effects.findIndex(e=>e.id===row.dataset.groupEffect);
 host.beforeEdit();host.editor.reorderVfxGroupEffect(clip.id,drag.id,index);host.sync();host.onChange();return true;
}
export function groupKeydown(host,event){
 const grip=event.target.closest('[data-vfx-group-drag]');if(!grip||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return false;
 event.preventDefault();event.stopPropagation();if(grip.disabled)return true;
 const row=groupRow(grip),clip=host.editor.getVfxClips().find(c=>c.id===row.closest('[data-clip-id]').dataset.clipId),index=clip.effects.findIndex(e=>e.id===row.dataset.groupEffect)+(event.key==='ArrowUp'?-1:1);
 if(index>=0&&index<clip.effects.length){host.commit();host.beforeEdit();host.editor.reorderVfxGroupEffect(clip.id,row.dataset.groupEffect,index);host.sync();host.root.querySelector(`[data-group-effect="${row.dataset.groupEffect}"] [data-vfx-group-drag]`)?.focus();host.onChange();}return true;
}
