import {drawingSelection} from './movieclip-drawings.mjs';
/** Animator controls are a view of native pose channels, not a second rig state. */
import {spatialBone} from './rig-spatial.mjs';
import {createSpatialGizmo,drawRotationGizmo,startRotationGizmo,rotateGizmo} from './spatial-gizmo.mjs';
const DEG=180/Math.PI,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const modes=new WeakMap();
export const spatialControlMode=editor=>modes.get(editor)??'pose';
export function spatialControlsView(editor){
 const bones=editor.figure?.segments.flatMap((s,i)=>spatialBone(s)?[{s,i}]:[])??[];if(!bones.length)return'';
 const mode=spatialControlMode(editor),pose=editor.getSpatialPose(),selected=editor.selectedJoint,ik=editor.object?._stykIK?.[editor.figure.segments[selected]?.segment_id];
 const targets=bones.filter(({s})=>editor.object?._stykIK?.[s.segment_id]?.enabled);
 const endpoint=({s,i})=>{const child=bones.find(b=>b.s._stykRig.spatial.parent===s.segment_id);return{index:mode==='rotate'&&child?child.i:i,name:child?.s.name??s.name};};
 const shortcuts=`<div class="spatial-targets" role="group" aria-label="Body controls"><button type="button" data-spatial-select="${mode==='rotate'?bones[0].i:-1}" aria-pressed="${selected===(mode==='rotate'?bones[0].i:-1)}">Whole body</button>${targets.map(t=>{const {index,name}=endpoint(t);return`<button type="button" data-spatial-select="${index}" aria-pressed="${selected===index}">${esc(name.replace(/ ankle$/,''))}</button>`;}).join('')}</div>`;
 const rows=pose?['pitch','turn','bend'].map((key,i)=>{const value=pose[key]*DEG,label=['Tilt','Turn','Bend'][i];return`<div class="spatial-axis spatial-${key}"><label for="spatial-${key}-number">${label}</label><input id="spatial-${key}-range" type="range" min="-180" max="180" step="0.1" value="${wrap(pose[key])*DEG}" data-spatial-axis="${key}" aria-label="${label}"><input id="spatial-${key}-number" type="number" step="1" value="${Math.round(value*10)/10}" data-spatial-axis="${key}" aria-label="${label} degrees"><span>°</span></div>`;}).join(''):'';
 return`<section class="inspector-section spatial-rig" data-section="spatial-rig"><div class="spatial-title"><strong>Character rig</strong><button type="button" data-spatial-reset="all" title="Restore all joint rotations and release pins">Reset pose</button></div><div class="spatial-modes" role="group" aria-label="Rig tools">${[['pose','Pose','Drag hands & feet'],['rotate','Rotate','Turn any joint']].map(([value,label,hint])=>`<button type="button" data-spatial-mode="${value}" aria-label="${label}" aria-pressed="${value===mode}">${label}<small>${hint}</small></button>`).join('')}</div>${shortcuts}<label class="spatial-select"><span>Selected part</span><select id="spatial-joint" aria-label="Articulation"><option value="-1" ${pose?'':'selected'}>Move whole character</option>${bones.map(({s,i})=>`<option value="${i}" ${selected===i?'selected':''}>${esc(s.name||'Joint '+s.segment_id)}</option>`).join('')}</select></label>${pose?`<p class="field-hint">${mode==='pose'?'Drag a hand or foot to place it. Rotate lets you turn the selected part in depth.':'Drag inside the sphere to rotate freely. Colored rings isolate an axis; the outer ring rotates in the view. Hold Shift for finer movement.'}</p>${mode==='rotate'?`<div class="spatial-axis-key"><span class="spatial-pitch">X · Tilt</span><span class="spatial-turn">Y · Turn</span><span class="spatial-bend">Z · Bend</span></div><details class="spatial-exact" data-section="spatial-exact"><summary>Exact angles</summary>${rows}</details>`:''}<div class="spatial-actions"><button type="button" data-spatial-reset="joint">Reset joint</button>${ik?.enabled?`<label title="Keep this hand or ankle in place while posing its parent"><input type="checkbox" id="spatial-pin" ${ik.pinned?'checked':''}>Pin target</label>`:''}</div>`:`<p class="field-hint">Drag the character’s origin to move it, or choose a hand or foot above.</p>`}</section>`;
}
export function spatialGizmo(editor,project){return spatialControlMode(editor)==='rotate'?createSpatialGizmo(editor,project):null;}
export function drawSpatialGizmo(ctx,editor,project){drawRotationGizmo(ctx,spatialGizmo(editor,project));}
export function spatialGizmoDrag(editor,point,project){
 const gizmo=spatialGizmo(editor,project);if(!gizmo)return null;
 // A visible neighboring pivot wins over an overlapping rotation sphere.
 const g=editor.geometry.objects.get(editor.selectedSlot);
 if(Math.hypot(point.x-gizmo.center.x,point.y-gizmo.center.y)>12&&g.segments.some((s,i)=>{if(i===editor.selectedJoint||!s.spatialFrame||s.static)return false;const p=project(s.start);return Math.hypot(p.x-point.x,p.y-point.y)<7;}))return null;
 return startRotationGizmo(gizmo,point);
}
export function updateSpatialGizmo(editor,drag,point,precision=false){editor.setSpatialPose(rotateGizmo(drag,point,precision));}

export function installSpatialControls({editor,root,refresh,guard}){
 let gesture;
 const finish=commit=>{if(!gesture)return;gesture=null;commit?editor.commitDrag():editor.cancelDrag();refresh();};
 root.addEventListener('pointerdown',guard(e=>{
  const range=e.target.closest('input[type=range][data-spatial-axis]');if(!range)return;
  if(e.button!==0||!e.isPrimary||!editor.getSpatialPose())return;
  finish(true);if(!editor.beginDrag('Rotate articulated joint'))return;gesture={uid:editor.selectedUid,index:editor.selectedJoint,element:range};
  gesture.element.setPointerCapture(e.pointerId);
 }));
 root.addEventListener('input',guard(e=>{if(!e.target.matches('input[type=range][data-spatial-axis]'))return;const key=e.target.dataset.spatialAxis,pose=editor.getSpatialPose();if(pose)editor.setSpatialPose({[key]:pose[key]+wrap(e.target.valueAsNumber/DEG-pose[key])});refresh();}));
 root.addEventListener('change',guard(e=>{
  const t=e.target;if(t.id==='spatial-joint'){finish(true);editor.select(editor.selectedUid,Number(t.value));refresh();}
  else if(t.matches('input[type=number][data-spatial-axis]')){editor.setSpatialPose({[t.dataset.spatialAxis]:t.valueAsNumber/DEG});refresh();}
  else if(t.id==='spatial-pin'){editor.setNodeIK({pinned:t.checked});refresh();}
  else if(t.dataset.drawingUid){const uid=Number(t.dataset.drawingUid),object=editor.selectionFrame.objects.find(o=>o.unique_id===uid),asset=editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id)?._styk?.movieclip;
   if(asset?.drawingSets){const prior=drawingSelection(asset,object),group=t.hasAttribute('data-drawing-group')?Number(t.value):prior.group,view=t.hasAttribute('data-drawing-view')?Number(t.value):Math.min(prior.view,asset.drawingSets[group].views.length-1);editor.setMovieclipDrawing(uid,group,view);refresh();}}

 }));
 root.addEventListener('click',guard(e=>{const mode=e.target.closest('[data-spatial-mode]');if(mode){finish(true);modes.set(editor,mode.dataset.spatialMode);const f=editor.figure,s=f?.segments[editor.selectedJoint];
  if(mode.dataset.spatialMode==='rotate'){
   const child=editor.object?._stykIK?.[s?.segment_id]?.enabled?f.segments.findIndex(n=>spatialBone(n)&&n._stykRig.spatial.parent===s.segment_id):-1;
   if(child>=0)editor.select(editor.selectedUid,child);else if(!editor.getSpatialPose())editor.select(editor.selectedUid,f.segments.findIndex(spatialBone));
  }else if(spatialBone(s)&&editor.object?._stykIK?.[s._stykRig.spatial.parent]?.enabled)editor.select(editor.selectedUid,f.segments.findIndex(n=>n.segment_id===s._stykRig.spatial.parent));refresh();return;}const target=e.target.closest('[data-spatial-select]');if(target){finish(true);editor.select(editor.selectedUid,Number(target.dataset.spatialSelect));refresh();return;}const t=e.target.closest('[data-spatial-reset]');if(t){finish(true);editor.resetSpatialPose(t.dataset.spatialReset==='all');refresh();}}));
 root.addEventListener('pointerup',()=>finish(true));root.addEventListener('pointercancel',()=>finish(false));root.addEventListener('lostpointercapture',()=>finish(true));
 root.addEventListener('keydown',guard(e=>{
  if(e.key==='Escape'&&gesture){e.preventDefault();e.stopPropagation();finish(false);return;}
 }));
 editor.addEventListener('change',()=>{if(gesture&&(gesture.uid!==editor.selectedUid||gesture.index!==editor.selectedJoint))finish(false);});
 return{finish};
}
