import {spatialPerspectiveAvailable} from './spatial-projection.mjs';
import {geometryPlans} from './pivot/geometry-pose.mjs';
import {drawingSelection} from './movieclip-drawings.mjs';
/** Animator controls are a view of native pose channels, not a second rig state. */
import {spatialBone,spatialPoint} from './rig-spatial.mjs';
import {ikChain} from './ik.mjs';
import {icon} from './icons.mjs';
import {poseChoiceGroups} from './rig-pose-choices.mjs';
import {propertyToggle} from './property-toggle.mjs';
import {createSpatialGizmo,drawRotationGizmo,startRotationGizmo,rotateGizmo} from './spatial-gizmo.mjs';
const DEG=180/Math.PI,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const modes=new WeakMap();
const applyPose=(editor,patch)=>editor.setSpatialPose(patch,{wholeFigure:spatialControlMode(editor)==='figure'});
export const spatialControlMode=editor=>modes.get(editor)??'pose';
function limbControl(editor){
 const f=editor.figure,index=editor.selectedJoint,s=f?.segments[index];if(!s)return null;
 const ancestors=new Set();let parent=s;while(parent?._stykRig?.spatial?.parent){ancestors.add(parent._stykRig.spatial.parent);parent=f.segments.find(n=>n.segment_id===parent._stykRig.spatial.parent);}
 for(const[id,c]of Object.entries(editor.object?._stykIK??{}))if(c.enabled&&c.spatialTarget&&(ancestors.has(Number(id))||ikChain(f,Number(id),c.chainLength,geometryPlans(editor.geometry.objects.get(editor.selectedSlot))?.definition).includes(index)))
  return{index:f.segments.findIndex(s=>s.segment_id===Number(id)),controller:c};
 return null;
}
export function spatialControlsView(editor){
 const bones=editor.figure?.segments.flatMap((s,i)=>spatialBone(s)&&!s._stykPoseChoice?[{s,i}]:[])??[];if(!bones.length)return'';
 const mode=spatialControlMode(editor),pose=editor.getSpatialPose(),selected=editor.selectedJoint,limb=limbControl(editor),ik=limb?.controller;
 const targets=bones.filter(({s})=>editor.object?._stykIK?.[s.segment_id]?.enabled),childOf=id=>bones.find(b=>b.s._stykRig.spatial.parent===id);
 const feet=targets.filter(({s})=>/foot|ankle/i.test(childOf(s.segment_id)?.s.name??'')),planted=feet.length&&feet.every(({s})=>editor.object._stykIK[s.segment_id].pinned);
 const choose=(index,name,focus=false)=>`<button type="button" data-spatial-${focus?'focus':'select'}="${index}" aria-pressed="${selected===index}">${esc(name)}</button>`;
 const choices=poseChoiceGroups(editor.figure,editor.object).map(g=>`<label class="spatial-choice"><span>${esc(g.name)}</span><select class="inline-select" data-spatial-choice="${esc(g.name)}" aria-label="${esc(g.name)}"><option value="0" ${g.value===0?'selected':''}>Hidden</option>${g.value===-1?'<option value="-1" selected disabled>Custom pose</option>':''}${g.choices.map(c=>`<option value="${c.id}" ${g.value===c.id?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label>`).join('');
 const shortcuts=`<div class="spatial-targets" role="group" aria-label="Body controls">${choose(-1,'Move figure')}<button type="button" data-spatial-whole aria-pressed="${mode==='figure'}">Rotate figure</button>${targets.map(({s,i})=>{const child=childOf(s.segment_id);return choose(mode!=='pose'&&child?child.i:i,(child?.s.name??s.name).replace(/ ankle$/,''));}).join('')}</div>`;
 const trunk=[['Pelvis','Hips'],['Lower torso','Torso'],['Waist','Waist'],['Chest','Chest'],[bones.some(b=>b.s.name==='Head')?'Head':'Neck','Head']].flatMap(([name,label])=>{const b=bones.find(b=>b.s.name===name);return b?[choose(b.i,label,true)]:[];}).join('');
 const rows=pose?['pitch','turn','bend'].map((key,i)=>{const value=pose[key]*DEG,label=['Tilt','Turn','Bend'][i];return`<div class="spatial-axis spatial-${key}"><label for="spatial-${key}-number">${label}</label><input id="spatial-${key}-range" type="range" min="-180" max="180" step="0.1" value="${wrap(pose[key])*DEG}" data-spatial-axis="${key}" aria-label="${label}"><label class="field"><input id="spatial-${key}-number" type="number" step="1" value="${Math.round(value*10)/10}" data-spatial-axis="${key}" aria-label="${label} degrees"><small>°</small></label></div>`;}).join(''):'';
 const endpoint=limb?childOf(editor.figure.segments[limb.index].segment_id):null,toe=endpoint?childOf(endpoint.s.segment_id):null;
 const isFoot=/foot|ankle/i.test(endpoint?.s.name??''),chain=limb?ikChain(editor.figure,editor.figure.segments[limb.index].segment_id,ik.chainLength,geometryPlans(editor.geometry.objects.get(editor.selectedSlot))?.definition):[];
 const rotations=chain.map((index,i)=>choose(index,isFoot?(i===0?'Thigh rotation':'Shin rotation'):(i===0?'Upper arm rotation':'Forearm rotation'),true)).join('')+(endpoint?choose(endpoint.i,isFoot?'Ankle rotation':'Hand rotation',true):'')+(toe?choose(toe.i,'Toe bend',true):'');
 const camera=editor.getSpatialCamera(),proportions=editor.getSpatialProportions();
 const parameter=(kind,key,label,value,min,max,step=1,unit='')=>`<div class="spatial-axis spatial-proportion"><label for="spatial-${kind}-${key}">${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-spatial-${kind}="${key}" aria-label="${label}"><label class="field"><input id="spatial-${kind}-${key}" type="number" min="${min}" max="${max}" step="${step}" value="${Math.round(value*100)/100}" data-spatial-${kind}="${key}" aria-label="${label} value"><small>${unit}</small></label></div>`;
 const perspective=spatialPerspectiveAvailable(editor.selectionFrame.objects,editor.object,editor.report.figure_types)?`<details class="spatial-exact" data-section="spatial-perspective"><summary>Perspective</summary>${parameter('camera','strength','Perspective',camera.strength*100,0,100,1,'%')}${parameter('camera','distance','Distance',camera.distance,100,2000,10)}<p class="property-context-caption">Move a hand or foot toward the camera to enlarge it. Lower distance gives stronger foreshortening. Use figure Scale to frame the shot.</p><div class="spatial-part-actions"><button type="button" class="spatial-reset" data-spatial-center-camera>Center on figure</button><button type="button" class="spatial-reset" data-spatial-reset-camera>Reset perspective</button></div></details>`:'<p class="property-context-caption">Perspective requires a single spatial figure. Joined drawings retain their original projection.</p>';
 const proportionsView=proportions?`<details class="spatial-exact" data-section="spatial-proportions"><summary>Shape · ${esc(editor.figure.segments[selected].name??'Joint')}</summary>${proportions.canResizeLength?parameter('shape','size','Part size',proportions.length*100,10,300,1,'%')+parameter('shape','length','Length',proportions.length*100,10,300,1,'%'):''}${parameter('shape','width','Width',proportions.width*100,10,300,1,'%')}${parameter('shape','taper','Taper',proportions.taper*100,-90,200,1,'%')}<p class="property-context-caption">Part size includes child joints. Length, width and taper adjust this bone; positive taper widens its tip.</p><button type="button" class="spatial-reset" data-spatial-reset-shape>Reset this bone’s shape</button></details>`:'';
 const targetShape=limb?editor.geometry.objects.get(editor.selectedSlot)?.segments[limb.index]:null;
 const depth=targetShape?.spatialFrame?spatialPoint(targetShape.spatialFrame,targetShape.seg._stykRig.spatial.tip)[2]*editor.object.scale:ik?.spatialTarget?.depth??0;
 const limbGeometry=limb?editor.geometry.objects.get(editor.selectedSlot):null,base=limbGeometry?.segments[chain[0]],baseDepth=base?.spatialFrame?spatialPoint(base.spatialFrame,base.seg._stykRig.spatial.origin)[2]*editor.object.scale:0;
 const reach=limb?Math.max(1,chain.reduce((sum,i)=>sum+(limbGeometry.solvedLengths?.[i]??(editor.object.len_flag?editor.object.lengths[i]:editor.figure.segments[i].length)),0)*editor.object.scale):1;
 const depthControl=ik?`<div class="spatial-depth">${parameter('reach','depth','Toward camera',depth,baseDepth-reach,baseDepth+reach,1)}<p class="property-context-caption">Left: away · Right: toward you. The leg or arm follows in 3D.</p></div>`:'';
 const limbTools=ik?`<div class="spatial-limb" data-section="spatial-limb"><div class="property-toggle-grid">${propertyToggle('spatial-pin',isFoot?'Plant foot':'Pin hand',ik.pinned,'pin',{title:'Keep target position and orientation when the body moves'})}</div><details class="spatial-exact" data-section="spatial-limb-options"><summary>More limb options</summary><div class="property-toggle-grid">${propertyToggle('spatial-stretch','Stretch',ik.allowStretch,'stretch-horizontal',{title:'Allow the limb to reach beyond its rest length'})}</div><label class="spatial-parameter"><span>Bend direction</span><input type="range" min="-180" max="180" step="1" value="${wrap(ik.spatialTarget.swivel)*DEG}" data-spatial-swivel aria-label="Bend direction"></label><label class="field"><span>Depth</span><input type="number" step="1" value="${Math.round(ik.spatialTarget.depth*10)/10}" data-spatial-depth aria-label="Target depth"><small>px</small></label></details><p class="property-context-caption">${ik.pinned?'Planted: position and orientation stay fixed.':isFoot?'Free: the foot follows the shin.':'Free: the hand follows the forearm.'}</p></div>`:'';
 const pad=pose&&mode!=='pose'?`<div class="spatial-orientation" data-section="spatial-orientation"><button type="button" class="spatial-pad" data-spatial-pad aria-label="Turn and tilt" title="Drag to turn and tilt · Arrow keys adjust · Shift for precision"><svg viewBox="0 0 90 72" aria-hidden="true"><path d="M8 36H82M45 7V65"/><circle cx="${45+Math.sin(pose.turn)*31}" cy="${36+Math.sin(pose.pitch)*23}" r="5"/></svg></button><div><strong>Turn / tilt</strong><p class="property-context-caption">Drag in two directions.<br>Shift for precision.</p><button type="button" class="spatial-reset" data-spatial-reset="joint">${mode==='figure'?'Reset orientation':'Reset joint'}</button></div></div><details class="spatial-exact" data-section="spatial-exact"><summary>Exact angles</summary>${rows}</details>`:'';
 return`<section class="inspector-section spatial-rig" data-section="spatial-rig"><div class="inspector-title"><span>Character rig</span><button type="button" class="icon-button" data-spatial-reset="all" title="Reset pose" aria-label="Reset pose">${icon('rotate')}</button></div><div class="spatial-modes" role="group" aria-label="Rig tools">${[['pose','Pose','move'],['rotate','Rotate','rotate']].map(([value,label,symbol])=>`<button type="button" data-spatial-mode="${value}" aria-label="${label}" aria-pressed="${value===(mode==='figure'?'rotate':mode)}">${icon(symbol)}${label}</button>`).join('')}</div>${shortcuts}${trunk?`<div class="spatial-trunk" role="group" aria-label="Torso controls">${trunk}</div>`:''}${bones.some(b=>/sash upper$/.test(b.s.name))?`<div class="spatial-part-actions" role="group" aria-label="Belt ties">${bones.filter(b=>/sash upper$/.test(b.s.name)).map(b=>choose(b.i,b.s.name.replace('sash upper','tie'))).join('')}</div>`:''}${feet.length?`<button type="button" class="spatial-plant" data-spatial-feet="${planted?'release':'plant'}">${icon('pin')}${planted?'Release feet':'Plant both feet'}</button>`:''}<select class="inline-select" id="spatial-joint" aria-label="Articulation"><option value="-1" ${pose?'':'selected'}>Move whole character</option>${bones.map(({s,i})=>`<option value="${i}" ${selected===i?'selected':''}>${esc(s.name||'Joint '+s.segment_id)}</option>`).join('')}</select>${ik?`<div class="spatial-targets" role="group" aria-label="Limb rotations">${rotations}</div>`:''}${pad}${depthControl}${limbTools}${proportionsView}${perspective}${choices}<p class="property-context-caption">${mode==='pose'?'Drag joints to swing them in 3D; hold Shift to swing behind. Right-drag twists a part, such as turning the head. Drag a planted knee or elbow to aim its bend.':'Rotate a limb to release its pin; its hand or foot follows. Torso turns retain planted targets. Rotate figure carries the entire pose.'}</p></section>`;
}
export function spatialGizmo(editor,project){return spatialControlMode(editor)!=='pose'?createSpatialGizmo(editor,project):null;}
export function drawSpatialGizmo(ctx,editor,project){
 drawRotationGizmo(ctx,spatialGizmo(editor,project));
}
export function spatialGizmoDrag(editor,point,project){
 const gizmo=spatialGizmo(editor,project);if(!gizmo)return null;
 // A visible neighboring pivot wins over an overlapping rotation sphere.
 const g=editor.geometry.objects.get(editor.selectedSlot);
 if(Math.hypot(point.x-gizmo.center.x,point.y-gizmo.center.y)>12&&g.segments.some((s,i)=>{if(i===editor.selectedJoint||!s.spatialFrame||s.static)return false;const p=project(s.start);return Math.hypot(p.x-point.x,p.y-point.y)<7;}))return null;
 return startRotationGizmo(gizmo,point);
}
export function updateSpatialGizmo(editor,drag,point,precision=false){
 applyPose(editor,rotateGizmo(drag,point,precision));
}

export function installSpatialControls({editor,root,refresh,guard}){
 let gesture,editingLimb=false;
 const withLimb=action=>{const limb=limbControl(editor);if(!limb)return;const selected=editor.selectedJoint;try{editingLimb=true;editor.selectedJoint=limb.index;action();}finally{editor.selectedJoint=selected;editingLimb=false;}};
 const finish=commit=>{if(!gesture)return;gesture=null;commit?editor.commitDrag():editor.cancelDrag();refresh();};
 root.addEventListener('pointerdown',guard(e=>{
  const pad=e.target.closest('[data-spatial-pad]');
  if(pad){if(e.button!==0||!e.isPrimary||!editor.getSpatialPose())return;finish(true);if(!editor.beginDrag('Turn and tilt'))return;gesture={uid:editor.selectedUid,index:editor.selectedJoint,element:pad,pad:true,pose:editor.getSpatialPose(),x:e.clientX,y:e.clientY};pad.setPointerCapture(e.pointerId);e.preventDefault();return;}
  const range=e.target.closest('input[type=range][data-spatial-axis],input[data-spatial-swivel],input[type=range][data-spatial-camera],input[type=range][data-spatial-shape],input[type=range][data-spatial-reach]');if(!range)return;
  if(e.button!==0||!e.isPrimary)return;
  finish(true);if(!editor.beginDrag('Adjust rig control'))return;gesture={uid:editor.selectedUid,index:editor.selectedJoint,element:range};
  gesture.element.setPointerCapture(e.pointerId);
 }));
 root.addEventListener('pointermove',guard(e=>{if(!gesture?.pad)return;const k=(e.shiftKey?.2:1)*Math.PI/180;applyPose(editor,{turn:gesture.pose.turn+(e.clientX-gesture.x)*k,pitch:gesture.pose.pitch+(e.clientY-gesture.y)*k});refresh();}));
 const adjust=t=>{
  if(t.hasAttribute('data-spatial-camera'))editor.setSpatialCamera({[t.dataset.spatialCamera]:t.valueAsNumber/(t.dataset.spatialCamera==='strength'?100:1)});
  else if(t.hasAttribute('data-spatial-shape'))editor.setSpatialProportions({[t.dataset.spatialShape]:t.valueAsNumber/100});
  else if(t.hasAttribute('data-spatial-reach'))withLimb(()=>editor.setSpatialIKTarget({depth:t.valueAsNumber}));
  else return false;
  refresh();return true;
 };
 root.addEventListener('input',guard(e=>{if(e.target.type==='range'&&adjust(e.target))return;if(e.target.matches('[data-spatial-swivel]')){withLimb(()=>editor.setSpatialIKTarget({swivel:e.target.valueAsNumber/DEG}));refresh();return;}if(!e.target.matches('input[type=range][data-spatial-axis]'))return;const key=e.target.dataset.spatialAxis,pose=editor.getSpatialPose();if(pose)applyPose(editor,{[key]:pose[key]+wrap(e.target.valueAsNumber/DEG-pose[key])});refresh();}));
 root.addEventListener('change',guard(e=>{
  const t=e.target;if(t.type==='number'&&adjust(t))return;if(t.id==='spatial-joint'){finish(true);if(spatialControlMode(editor)==='figure')modes.set(editor,'rotate');editor.select(editor.selectedUid,Number(t.value));refresh();}
  else if(t.matches('input[type=number][data-spatial-axis]')){applyPose(editor,{[t.dataset.spatialAxis]:t.valueAsNumber/DEG});refresh();}
  else if(t.matches('[data-spatial-choice]')){editor.setPoseChoice(t.dataset.spatialChoice,Number(t.value));refresh();}
  else if(t.id==='spatial-pin'){withLimb(()=>editor.setNodeIK({pinned:t.checked}));refresh();}
  else if(t.id==='spatial-stretch'){withLimb(()=>editor.setNodeIK({allowStretch:t.checked}));refresh();}
  else if(t.matches('[data-spatial-depth]')){withLimb(()=>editor.setSpatialIKTarget({depth:t.valueAsNumber}));refresh();}
  else if(t.dataset.drawingUid){const uid=Number(t.dataset.drawingUid),object=editor.selectionFrame.objects.find(o=>o.unique_id===uid),asset=editor.report.figure_types.find(f=>f.figure_type_id===object?.figure_type_id)?._styk?.movieclip;
   if(asset?.drawingSets){const prior=drawingSelection(asset,object),group=t.hasAttribute('data-drawing-group')?Number(t.value):prior.group,view=t.hasAttribute('data-drawing-view')?Number(t.value):Math.min(prior.view,asset.drawingSets[group].views.length-1);editor.setMovieclipDrawing(uid,group,view);refresh();}}

 }));
 root.addEventListener('click',guard(e=>{if(e.target.closest('[data-spatial-center-camera]')){finish(true);const p=editor.geometry.objects.get(editor.selectedSlot).root;editor.setSpatialCamera({centerX:p.x,centerY:p.y});refresh();return;}if(e.target.closest('[data-spatial-reset-camera]')){finish(true);editor.setSpatialCamera({strength:0,distance:600});refresh();return;}if(e.target.closest('[data-spatial-reset-shape]')){finish(true);editor.resetSpatialProportions();refresh();return;}const whole=e.target.closest('[data-spatial-whole]');if(whole){finish(true);modes.set(editor,'figure');editor.select(editor.selectedUid,editor.figure.segments.findIndex(s=>spatialBone(s)&&!s._stykRig.spatial.parent));refresh();return;}const focus=e.target.closest('[data-spatial-focus]');if(focus){finish(true);modes.set(editor,'rotate');editor.select(editor.selectedUid,Number(focus.dataset.spatialFocus));refresh();return;}const feet=e.target.closest('[data-spatial-feet]');if(feet){finish(true);editor.setSpatialFeetPinned(feet.dataset.spatialFeet==='plant');refresh();return;}const mode=e.target.closest('[data-spatial-mode]');if(mode){finish(true);modes.set(editor,mode.dataset.spatialMode);const f=editor.figure,s=f?.segments[editor.selectedJoint];
  if(mode.dataset.spatialMode==='rotate'){
   const child=editor.object?._stykIK?.[s?.segment_id]?.enabled?f.segments.findIndex(n=>spatialBone(n)&&n._stykRig.spatial.parent===s.segment_id):-1;
   if(child>=0)editor.select(editor.selectedUid,child);else if(!editor.getSpatialPose())editor.select(editor.selectedUid,f.segments.findIndex(spatialBone));
  }else if(spatialBone(s)&&editor.object?._stykIK?.[s._stykRig.spatial.parent]?.enabled)editor.select(editor.selectedUid,f.segments.findIndex(n=>n.segment_id===s._stykRig.spatial.parent));refresh();return;}const target=e.target.closest('[data-spatial-select]');if(target){finish(true);if(spatialControlMode(editor)==='figure'||Number(target.dataset.spatialSelect)===-1)modes.set(editor,'pose');editor.select(editor.selectedUid,Number(target.dataset.spatialSelect));refresh();return;}const t=e.target.closest('[data-spatial-reset]');if(t){finish(true);if(t.dataset.spatialReset==='joint'&&spatialControlMode(editor)==='figure')applyPose(editor,{bend:0,turn:0,pitch:0});else editor.resetSpatialPose(t.dataset.spatialReset==='all');refresh();}}));
 root.addEventListener('pointerup',()=>finish(true));root.addEventListener('pointercancel',()=>finish(false));root.addEventListener('lostpointercapture',()=>finish(true));
 root.addEventListener('keydown',guard(e=>{
  if(e.key==='Escape'&&gesture){e.preventDefault();e.stopPropagation();finish(false);return;}
  if(e.target.closest('[data-spatial-pad]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const p=editor.getSpatialPose(),key=/Left|Right/.test(e.key)?'turn':'pitch',sign=/Left|Up/.test(e.key)?-1:1;if(p)applyPose(editor,{[key]:p[key]+sign*(e.shiftKey?1:5)/DEG});refresh();}
 }));
 editor.addEventListener('change',()=>{if(spatialControlMode(editor)==='figure'&&editor.figure?.segments[editor.selectedJoint]?._stykRig?.spatial?.parent)modes.set(editor,'rotate');if(gesture&&!editingLimb&&(gesture.uid!==editor.selectedUid||gesture.index!==editor.selectedJoint))finish(false);});
 return{finish};
}
