import {icon} from './icons.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function polygonSurfaceView(editor,index) {
  const surface=editor.figure.polyfills[index]._stykSurface,side=surface?.side??(surface?'front':'both');
  return `<div class="fill-facing"><label class="rig-select"><span>Visible sides</span><select class="inline-select" data-polygon-side="${index}" aria-label="Visible sides">${[['both','Both'],['front','Front'],['back','Back']].map(([v,l])=>`<option value="${v}" ${side===v?'selected':''}>${l}</option>`).join('')}</select></label><button class="icon-button" data-polygon-flip="${index}" aria-label="Flip facing" title="Flip facing" aria-pressed="${Boolean(surface?.flipped)}" ${surface?'':'disabled'}>${icon('flip')}</button></div>${surface?`<button class="button fill-reference" data-polygon-reference="${index}">${icon('origin')}Reference joints</button>`:''}`;
}

/** A local draft; Apply is one normal figure edit. Search suggestions stay
 * bounded even in a figure with 30,000 joints. */
export function openSurfaceReference(editor,index,host,{side}={}) {
  const figure=editor.figure,polygon=figure?.polyfills?.[index];if(!polygon)return;
  const token=editor._documentToken,uid=editor.selectedUid,type=figure.figure_type_id,id=polygon.polyfill_id;
  const surface=polygon._stykSurface??figure.polyfills.find(p=>p._stykSurface)?._stykSurface;
  const joints=[{id:0,name:'Origin'},...figure.segments.map(s=>({id:s.segment_id,name:s.name||`Joint ${s.segment_id}`}))];
  const labels=new Map(joints.map(j=>[j.id,`${j.id} · ${j.name}`])),basis=surface?.basis??[0,null,null];
  host.showDialog('Reference joints',`<form id="fill-reference-form"><div class="fill-reference-fields">${['Origin','X joint','Y joint'].map((label,i)=>`<label class="rig-select"><span>${label}</span><input class="inline-select" data-face-axis="${i}" aria-label="${label}" list="face-axis-${i}" autocomplete="off" value="${esc(labels.get(basis[i])??'')}"><datalist id="face-axis-${i}"></datalist></label>`).join('')}</div><p class="property-note" id="fill-reference-error" role="status" hidden></p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">Apply</button></div></form>`);
  const form=document.getElementById('fill-reference-form'),inputs=[...form.querySelectorAll('[data-face-axis]')];
  const depthField=document.createElement('label');depthField.className='rig-select';
  depthField.innerHTML='<span>Depth joints (optional)</span><input class="inline-select" aria-label="Depth joints" placeholder="Joint IDs separated by commas"><small class="property-note">Their average position along the reference X axis offsets this fill’s Z-index.</small>';
  const depthInput=depthField.querySelector('input');depthInput.value=(polygon._stykSurface?.depth??[]).join(', ');
  form.querySelector('.fill-reference-fields').append(depthField);
  for(const input of inputs){
    const suggest=()=>{const query=input.value.includes(' · ')?'':input.value.trim().toLowerCase(),found=[];
      for(const joint of joints){if(!query||String(joint.id)===query||joint.name.toLowerCase().includes(query)){found.push(`<option value="${esc(labels.get(joint.id))}"></option>`);if(found.length===60)break;}}
      input.list.innerHTML=found.join('');};
    input.addEventListener('input',suggest);input.addEventListener('focus',()=>input.select());suggest();
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    try{
      if(token!==editor._documentToken||uid!==editor.selectedUid||type!==editor.figure?.figure_type_id||editor.figure.polyfills[index]?.polyfill_id!==id)throw new Error('The fill changed. Close this dialog and select it again.');
      const basis=inputs.map(input=>{const match=/^(\d+)(?: · .*)?$/.exec(input.value.trim());return match?Number(match[1]):NaN;});
      const text=depthInput.value.trim(),depth=text?text.split(',').map(value=>/^\d+$/.test(value.trim())?Number(value.trim()):NaN):undefined;
      editor.updatePolygon(index,{surface:{basis,side:side??polygon._stykSurface?.side??'front',flipped:polygon._stykSurface?.flipped??false,...(depth?{depth}:{})}});host.closeDialog();
    }catch(error){const status=form.querySelector('[role="status"]');status.hidden=false;status.textContent=error.message;}
  });
  inputs[basis[1]===null?1:0].focus();
}

export function changeSurfaceSide(editor,index,side,host) {
  if(side==='both')return editor.updatePolygon(index,{surface:null});
  const own=editor.figure.polyfills[index]._stykSurface,reference=editor.figure.polyfills.find(p=>p._stykSurface)?._stykSurface;
  const surface=own??(reference?{basis:reference.basis,flipped:false}:null);
  if(!surface){openSurfaceReference(editor,index,host,{side});return false;}
  return editor.updatePolygon(index,{surface:{...surface,side}});
}
