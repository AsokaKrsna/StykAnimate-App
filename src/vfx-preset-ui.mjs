/**
 * The VFX panel's side of the person's own presets (vfx-user-presets.mjs):
 * saving the selected effect under a name, the My presets cards in the
 * catalogue and the suggestions, and renaming or deleting a preset. Presets
 * live outside the project, so none of this is part of undo.
 */
import {vfxPresetStore,presetName,USER_PRESET_NAME_LENGTH} from './vfx-user-presets.mjs';
import {VFX_REGISTRY} from './vfx.mjs';
import {effectAvailable} from './vfx-registry.mjs';
import {vfxTile} from './vfx-icons.mjs';
import {icon} from './icons.mjs';
import {prompt,confirm} from './ui/ui-dialog.mjs';
import {showTimelineMenu} from './timeline-menu.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** The prefix of a My presets choice in the catalogue (`mine:<id>`). */
export const MINE='mine:';

/** A preset's glyph: its one effect's, or the group glyph. */
export const presetTile=(preset,className)=>{const d=preset.effects.length===1&&VFX_REGISTRY[preset.effects[0].type];return d?vfxTile(d.icon,d.category,className):vfxTile('effects','Looks',className);};
/** What a preset holds, in a few words: "Glow", "3 effects", with "animated" when it has keys. */
export const presetSummary=preset=>{const count=preset.effects.length,animated=Object.keys(preset.keys).length>0;return `${count===1?VFX_REGISTRY[preset.effects[0].type]?.name??'Effect':`${count} effects`}${animated?' · animated':''}`;};
/** The presets that can go on this kind of target (scene-only effects need the scene). */
export const usablePresets=scene=>vfxPresetStore.presets.filter(preset=>preset.effects.every(effect=>effectAvailable(effect.type,scene)));

/** The catalogue's My presets section: a card per preset with its ⋯, or a note on how to make one. */
export function myPresetsSection(scene,query,{disabled=false}={}){
 const presets=usablePresets(scene).filter(p=>(p.name+' '+presetSummary(p)).toLowerCase().includes(query));
 if(query&&!presets.length)return '';
 const body=presets.length
  ?`<div class="vfx-catalog-grid vfx-my-presets">${presets.map(p=>`<div class="vfx-my-preset"><button type="button" class="vfx-catalog-card" data-choice="${MINE}${esc(p.id)}" ${disabled?'disabled':''}>${presetTile(p,'vfx-catalog-art')}<span class="vfx-my-preset-text"><span>${esc(p.name)}</span><small>${esc(presetSummary(p))}</small></span></button><button type="button" class="ui-icon-button vfx-my-preset-more" data-size="xs" data-preset-menu="${esc(p.id)}" aria-label="${esc(p.name)} preset actions" aria-haspopup="menu">${icon('more')}</button></div>`).join('')}</div>`
  :`<p class="vfx-my-presets-empty">${icon('library')}<span>Save an effect you like with <b>Save as preset</b> under its settings, and it waits here for any figure or project.</span></p>`;
 return `<section class="vfx-my-presets-section"><h3>My presets</h3>${body}</section>`;
}

/**
 * Asks for a name and saves the clip `id` as a preset. A name already in use asks before replacing that
 * preset. `button` (optional) confirms in place with "Saved to My presets".
 */
export async function savePresetFromClip(host,id,button){
 const clip=host.editor.getVfxClips().find(c=>c.id===id);if(!clip)return;
 await vfxPresetStore.load();
 const name=await prompt({title:'Save as preset',label:'Name',value:clip.name||VFX_REGISTRY[clip.effects[0]?.type]?.name||'Effects',maxLength:USER_PRESET_NAME_LENGTH,confirmLabel:'Save',
  description:'Keeps its effects, settings, timing and keys, ready to add to any figure or the scene.',validate:text=>presetName(text)?null:'Name the preset.'});
 if(name==null)return;
 const existing=vfxPresetStore.named(name);
 if(existing&&!await confirm({title:`Replace “${existing.name}”?`,description:'That preset takes this effect’s settings. Figures that already use it keep theirs.',confirmLabel:'Replace'}))return;
 try{await vfxPresetStore.save(clip,name);}catch(error){host.onError(error);return;}
 if(button?.isConnected)flash(button,'Saved to My presets');
}
function flash(button,text){
 const label=button.querySelector('.ui-label');if(!label)return;
 clearTimeout(button._flash);button.dataset.saved='';label.textContent=text;
 button._flash=setTimeout(()=>{delete button.dataset.saved;label.textContent=button.dataset.label??label.textContent;},2200);
}

/** A My presets card's menu (its ⋯ or a right-click): Rename… and Delete…. */
export function openPresetMenu(host,id,event,{onDone=()=>{}}={}){
 const preset=vfxPresetStore.find(id);if(!preset)return;
 let menu=host.presetMenu;
 if(!menu){menu=host.presetMenu={editor:host.editor,_run:fn=>host.run(fn)};host.abort.signal.addEventListener('abort',()=>{menu.menuEvents?.abort();menu.menu?.remove();},{once:true});}
 const run=fn=>()=>{host.closePopup();void fn().catch(error=>host.onError(error)).finally(onDone);};
 showTimelineMenu(menu,event,[
  [{label:'Rename…',symbol:'text',action:run(async()=>{const name=await prompt({title:'Rename preset',label:'Name',value:preset.name,maxLength:USER_PRESET_NAME_LENGTH,confirmLabel:'Rename',validate:text=>{const title=presetName(text),other=title&&vfxPresetStore.named(title);return !title?'Name the preset.':other&&other.id!==id?`A preset named “${other.name}” already exists.`:null;}});if(name!=null)await vfxPresetStore.rename(id,name);})}],
  [{label:'Delete…',symbol:'trash',danger:true,action:run(async()=>{if(await confirm({title:`Delete “${preset.name}”?`,description:'Effects already added from it stay as they are.',confirmLabel:'Delete',danger:true}))await vfxPresetStore.remove(id);})}],
 ]);
}
