/** Rig UI uses the existing inspector fields, buttons and delegated commands. */
import {icon} from './icons.mjs';
import {rigConstraintPlan} from './rig-constraints.mjs';
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(id,label,value,min,max,unit='')=>`<label class="field"><span>${label}</span><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="any" aria-label="${label}"><small>${unit}</small></label>`;
export function rigControlsView(editor,{builder=false}={}) {
  if(!builder)return '';
  const seg=editor.figure?.segments[editor.selectedJoint];if(!seg)return '';
  const r=seg._stykRig??{},c=r.connector,d=r.stretch,f=r.follow,response=r.response??{},lock=r.angleLock;
  const plan=rigConstraintPlan(editor.figure),source=plan.inputs[editor.selectedJoint];
  const option=(v,label,current)=>`<option value="${v}" ${v===current?'selected':''}>${label}</option>`;
  const select=(id,label,items,current)=>`<label class="rig-select"><span>${label}</span><select id="${id}" class="inline-select" aria-label="${label}">${items.map(([v,l])=>option(v,l,current)).join('')}</select></label>`;
  const check=(id,label,checked,glyph,title='')=>`<label class="check-row rig-toggle" title="${esc(title)}"><span>${icon(glyph)}${label}</span><input id="${id}" type="checkbox" ${checked?'checked':''}></label>`;
  const pick=(action,label)=>`<button class="icon-button" data-action="${action}" title="${label}" aria-label="${label}">${icon('origin')}</button>`;
  const name=id=>esc(id===0?'Origin':editor.figure.segments[plan.ids.get(id)]?.name||`Joint ${id}`);
  let body=c?`<div class="rig-anchors">${['start','end'].map((key,i)=>`<div class="rig-anchor"><span class="rig-anchor-letter">${i?'B':'A'}</span><span class="rig-anchor-name" title="${name(c[key])}">${name(c[key])}</span>${pick(`rig-pick-${key}`,`Pick anchor ${i?'B':'A'} on canvas`)}</div>`).join('')}</div>`:
    `<button class="button rig-connect" data-action="rig-connect">${icon('link')}Connect joints</button>`;
  body+=check('rig-stretch-enabled','Smart Stretch',d,'expand','Hold Ctrl while dragging to stretch. New attached parts follow automatically.');
  if(d) {
    if(c)body+=select('rig-source','Driven by',[['span','Anchor distance'],['slide','Slide position'],['combined','Distance × slide']],d.source??'span');
    body+=`<details class="rig-advanced"><summary>${icon('sliders')}Stretch settings</summary><div class="rig-settings">
      ${field('rig-rest','Rest length',d.restLength,.0001,1e6,'px')}
      ${c&&d.source&&d.source!=='span'?field('rig-rest-position','Rest slide',d.restPosition*100,.01,100,'%'):''}
      <div class="rig-field-pair">${field('rig-min','Minimum',d.min*100,0,10000,'%')}${field('rig-max','Maximum',d.max*100,1,10000,'%')}</div>
      ${select('rig-width','Width response',[['keep','Keep width'],['inverse','Thicken on compression'],['scale','Scale with length']],d.width)}
      ${!d.branch?check('rig-auto-branch','Include new parts',false,'builder-branch'):''}</div></details>`;
  }
  if(source||f||r.response){
    body+=`<div class="rig-response">${select('rig-response','Stretch response',[['stretch','Stretch'],['rigid','Keep rigid · pass through'],['stop','Stop at this joint']],response.mode??f?.mode??'stretch')}`;
    if((response.mode??f?.mode??'stretch')==='stretch')body+=field('rig-multiplier','Multiplier',response.multiplier??1,-10,10,'×');
    if(response.mode!=='stop')body+=check('rig-reset-impulse','Reset impulse here',response.reset,'reset','Restart the stretch axis at this joint and its children.');
    body+='</div>';
  }
  if(!c){
    body+=select('rig-angle-lock','Angle lock',[['off','Off'],['figure','Figure'],['parent','Movable parent'],['world','World']],lock?.mode??'off');
    if(lock)body+=`<div class="rig-field-pair">${field('rig-lock-angle','Locked angle',Math.round(lock.angle*180/Math.PI*100)/100,-36000,36000,'°')}${lock.mode==='parent'?field('rig-lock-multiplier','Rotation',lock.multiplier,-10,10,'×'):''}</div>`;
    if(lock)body+=select('rig-lock-space','Apply angle lock',[['rendered','After stretch'],['authored','Before stretch']],lock.space??'rendered');
    if(lock?.mode==='parent')body+=`<details class="rig-advanced"><summary>Add a second rotation</summary>${field('rig-lock-secondary','Second joint (0 = off)',lock.secondary?.reference??0,0,65535)}${lock.secondary?field('rig-lock-secondary-multiplier','Second rotation',lock.secondary.multiplier,-10,10,'×')+field('rig-lock-secondary-rest','Second rest angle',lock.secondary.restAngle*180/Math.PI,-36000,36000,'°'):''}</details>`;
    body+=`<details class="rig-advanced"><summary>${icon('link')}Attachment settings</summary><div class="rig-settings"><div class="rig-anchor"><span class="rig-anchor-name">${source?name(editor.figure.segments[source.driver].segment_id):'Automatic'}</span>${pick('rig-pick-driver','Pick stretch driver on canvas')}</div>
      ${select('rig-orientation','Attachment orientation',[['inherit','Follow connector'],['world','Keep authored angle']],r.orientation??'inherit')}
      ${f&&!f.automatic&&response.multiplier===undefined?field('rig-influence','Legacy influence',f.influence,-4,4,'×'):''}
      </div></details>`;
  }
  return `<section class="inspector-section rig-properties"><div class="inspector-title"><span>${icon('nodes')}Rig</span><button class="icon-button" data-action="rig-test" aria-label="Test rig" title="Test rig">${icon('play')}</button></div>${body}</section>`;
}
export function rigControlChange(editor,target) {
  const id=target.id;if(!id.startsWith('rig-')||id==='rig-mode')return false;
  const value=target.valueAsNumber;
  if(id==='rig-position')editor.setConnectorPosition(value/100);
  else if(id==='rig-stretch-enabled')editor.enableSmartStretch(target.checked);
  else if(id==='rig-rest')editor.setRigBehavior({stretch:{restLength:value}});
  else if(id==='rig-min')editor.setRigBehavior({stretch:{min:value/100}});
  else if(id==='rig-max')editor.setRigBehavior({stretch:{max:value/100}});
  else if(id==='rig-width')editor.setRigBehavior({stretch:{width:target.value}});
  else if(id==='rig-auto-branch')editor.enableSmartStretch(true);
  else if(id==='rig-source'){
    const seg=editor.figure.segments[editor.selectedJoint],position=editor.object.len_flag?editor.object.lengths[editor.selectedJoint]:seg.length;
    editor.setRigBehavior({stretch:{source:target.value,restPosition:seg._stykRig.stretch.restPosition??Math.max(.0001,position)}});
  }
  else if(id==='rig-rest-position')editor.setRigBehavior({stretch:{restPosition:value/100}});
  else if(id==='rig-response')editor.setRigBehavior({response:{mode:target.value}});
  else if(id==='rig-multiplier')editor.setRigBehavior({response:{multiplier:value}});
  else if(id==='rig-reset-impulse')editor.setRigBehavior({response:{reset:target.checked}});
  else if(id==='rig-angle-lock')editor.setAngleLock(target.value);
  else if(id==='rig-lock-angle')editor.setRigBehavior({angleLock:{angle:value*Math.PI/180}});
  else if(id==='rig-lock-multiplier')editor.setRigBehavior({angleLock:{multiplier:value}});
  else if(id==='rig-lock-space')editor.setRigBehavior({angleLock:{space:target.value}});
  else if(id==='rig-lock-secondary')editor.setSecondaryAngleReference(value);
  else if(id==='rig-lock-secondary-multiplier')editor.setRigBehavior({angleLock:{secondary:{...editor.figure.segments[editor.selectedJoint]._stykRig.angleLock.secondary,multiplier:value}}});
  else if(id==='rig-lock-secondary-rest')editor.setRigBehavior({angleLock:{secondary:{...editor.figure.segments[editor.selectedJoint]._stykRig.angleLock.secondary,restAngle:value*Math.PI/180}}});
  else if(id==='rig-orientation')editor.setRigBehavior({orientation:target.value});
  else if(id==='rig-follow-driver')editor.bindStretchParts(value);
  else if(id==='rig-follow-mode')editor.setRigBehavior({follow:{mode:target.value}});
  else if(id==='rig-follow-rigid')editor.setRigBehavior({response:{mode:target.checked?'rigid':'stretch'}});
  else if(id==='rig-influence')editor.setRigBehavior({follow:{influence:value}});
  else if(id.startsWith('rig-anchor-'))editor.setRigBehavior({connector:{[id.slice(11)]:value}});
  else return false;
  return true;
}
export function connectorPositionView(editor) {
  const seg=editor.figure.segments[editor.selectedJoint],t=editor.object.len_flag?editor.object.lengths[editor.selectedJoint]:seg.length;
  return field('rig-position','Slide position',Math.round(t*10000)/100,0,100,'%');
}
/** Only the selected slider gets endpoint guides; never document artwork. */
export function drawConnectorGuides(ctx,geometry,editor,project) {
  const s=geometry.objects.get(editor.selectedSlot)?.segments[editor.selectedJoint];
  if(!s?.connector)return;
  const h=project(s.handle),a=project(s.start),b=project(s.end);
  ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#808080';ctx.setLineDash([2,4]);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(h.x,h.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
  ctx.font='10px sans-serif';ctx.fillStyle='#808080';
  ctx.fillText('A',a.x+9,a.y-9);ctx.fillText('B',b.x+9,b.y-9);ctx.restore();
}
export function drawRigGuides(ctx,geometry,editor,project) {
  const g=geometry.objects.get(editor.selectedSlot),s=g?.segments[editor.selectedJoint];if(!s)return;
  const rig=s.seg._stykRig;if(!rig)return;
  ctx.save();ctx.strokeStyle='#0d99ff';ctx.fillStyle='#0d99ff';ctx.lineWidth=1.5;
  const ring=p=>{const q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,9,0,Math.PI*2);ctx.stroke();};
  if(rig.follow){const p=g.joints.get(rig.follow.driver);if(p)ring(p);}
  if(rig.stretch){const plan=rigConstraintPlan(editor.figure);for(const part of g.segments)if(plan.inputs[part.index]?.driver===s.index){ctx.globalAlpha=.5;ctx.lineWidth=3;ctx.beginPath();part.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();}}
  ctx.restore();
}
