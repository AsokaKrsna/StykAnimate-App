/** Named drawing substitutions select existing single frames. No interpolation
 * or new playback channel is introduced. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateDrawingSets(asset){
 const sets=asset.drawingSets;if(sets===undefined)return;
 const name=s=>typeof s==='string'&&s.trim().length>0&&s.length<=120;
 if(!Array.isArray(sets)||!sets.length||sets.length>128)throw new Error('Drawing sets need 1–128 groups.');
 for(const set of sets){if(!set||!name(set.name)||!Array.isArray(set.views)||!set.views.length||set.views.length>256)throw new Error('A drawing set needs a name and 1–256 views.');
  for(const v of set.views)if(!v||!name(v.name)||!Number.isInteger(v.frame)||v.frame<0||v.frame>=asset.duration)throw new Error('Drawing views must select existing clip frames.');}
}
export function drawingSelection(asset,object){
 const frame=object._stykMovieclip?.offset??0,sets=asset.drawingSets;
 let group=sets.findIndex(s=>s.views.some(v=>v.frame===frame));if(group<0)group=0;
 return{group,view:Math.max(0,sets[group].views.findIndex(v=>v.frame===frame))};
}
export function drawingSetsView(figure,object){
 const asset=figure?._styk?.movieclip;if(!asset?.drawingSets)return'';
 const{group,view}=drawingSelection(asset,object),sets=asset.drawingSets,select=(key,label,items,current)=>`<label class="spatial-choice"><span>${label}</span><select class="inline-select" data-drawing-${key} data-drawing-uid="${object.unique_id}" aria-label="${esc(figure.name)} ${label.toLowerCase()}">${items.map((item,i)=>`<option value="${i}" ${i===current?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`;
 return`<section class="inspector-section spatial-rig" data-section="drawing-bank-${object.unique_id}"><strong>${esc(figure.name)}</strong>${select('group','Form',sets,group)}${select('view','View',sets[group].views,view)}</section>`;
}
export function joinedDrawingSetsView(editor){
 const objects=editor.selectionFrame?.objects??[],types=new Map(editor.report.figure_types.map(f=>[f.figure_type_id,f]));
 return objects.filter(o=>o.join?.target_unique_id===editor.selectedUid).map(o=>drawingSetsView(types.get(o.figure_type_id),o)).join('');
}
