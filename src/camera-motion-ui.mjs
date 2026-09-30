import {CAMERA_MOTION_TYPES,MOTION_PARAMETERS,isWholeMotionParameter,validateCameraMotion} from './camera-motion.mjs';
import {followFramingOffset} from './camera-follow.mjs';
import {CameraMotionGraph,motionGraphView} from './camera-motion-graph.mjs';
import {drawCameraMonitor,cameraMonitorVisible} from './camera-monitor.mjs';
import {validateParallax} from './layer-parallax.mjs';
import {icon} from './icons.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={follow:'person',shake:'activity',handheld:'camera',wobble:'rotate',impact:'center',pulse:'zoom-in'};
/** What each preset does, in the words the gallery and the card use. */
export const MOTION_DESCRIPTIONS=Object.freeze({follow:'Keeps the selected figures in frame',shake:'A sudden, jittery rattle',handheld:'A gentle, living drift',wobble:'A steady rhythmic sway',impact:'One hard hit that settles',pulse:'A quick punch in and out'});
const action=(name,symbol,label,extra='')=>`<button class="ui-icon-button" data-size="sm" data-motion-action="${name}" title="${label}" aria-label="${label}" ${extra}>${icon(symbol)}</button>`;
const scrubLabel=(label,enabled=true,disabled=false)=>`<span ${enabled?`class="property-scrub" data-property-scrub tabindex="${disabled?-1:0}" role="button" ${disabled?'aria-disabled="true"':''} aria-label="Scrub ${label}" title="Drag to adjust · Shift: fine · Alt: extra fine"`:''}>${label}</span>`;
const field=(label,key,value,unit='',extra='',step=1,precision=0,disabled=false)=>`<div class="property-row" data-property-row="motion_${key}"><label class="field motion-field">${scrubLabel(label,key!=='seed',disabled)}<input type="number" data-motion-field="${key}" data-property="motion_${key}" data-property-value="${value}" data-property-step="${step}" data-property-precision="${precision}" value="${Number(value.toFixed(4))}" aria-label="${label}" ${extra}><small>${unit}</small></label></div>`;
const factorOf=key=>MOTION_PARAMETERS[key][4]==='%'?100:1;
function parameter(clip,key,disabled,label=MOTION_PARAMETERS[key][0]){const [,min,max,step,unit]=MOTION_PARAMETERS[key],factor=factorOf(key),whole=isWholeMotionParameter(key);return field(label,key,clip.params[key]*factor,unit==='frames'?'f':unit,`min="${min*factor}" max="${max*factor}" step="${whole?1:'any'}"`,step*factor,whole?0:3,disabled);}
/**
 * A slider with its typed value. The slider covers the useful range (`soft`); typing reaches the full saved range.
 * `key` may be a pseudo field: `move` sets Move X and Y together.
 */
function slider(clip,key,label,soft,disabled,hint=''){
  const param=key==='move'?'moveX':key,[,min,max,step,unit]=MOTION_PARAMETERS[param],factor=factorOf(param),value=clip.params[param]*factor;
  const top=Math.max(soft,value),lower=min*factor,percent=top>lower?Math.round((value-lower)/(top-lower)*1000)/10:0,whole=isWholeMotionParameter(param);
  const shown=unit==='frames'?'f':unit==='%'?'%':unit;
  return `<div class="ui-slider-row motion-slider-row" data-motion-row="${key}" data-property-row="motion_${key}"${hint?` title="${esc(hint)}"`:''}><span class="ui-slider-label">${label}</span>`+
    `<input class="ui-slider" type="range" data-motion-field="${key}" min="${lower}" max="${top}" step="${whole?1:step*factor}" value="${value}" style="--_p:${percent}%" aria-label="${label}" ${disabled?'disabled':''}>`+
    `<label class="motion-slider-value"><input type="number" data-motion-field="${key}" min="${lower}" max="${max*factor}" step="${whole?1:'any'}" value="${Number(value.toFixed(whole?0:2))}" aria-label="${label} value" ${disabled?'disabled':''}><small>${shown}</small></label></div>`;
}
function figureName(editor,uid){
  const object=editor.selectionFrame.objects.find(o=>o.unique_id===uid)??editor.evaluatedFrame.objects.find(o=>o.unique_id===uid);
  return object?editor.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id)?.name||`Figure ${uid}`:null;
}
const followSummary=(editor,clip)=>clip.targets.map(t=>figureName(editor,t.uid)??'Missing figure').join(', ');
function gallery(locked,compact){
  return `<div class="motion-gallery${compact?' is-compact':''}" role="group" aria-label="Add a camera move">${Object.entries(CAMERA_MOTION_TYPES).map(([type,name])=>
    `<button type="button" class="motion-tile" data-motion-add="${type}" data-kind="${type}" ${locked?'disabled':''}><span class="motion-tile-icon">${icon(symbols[type])}</span><span class="motion-tile-text"><strong>${name}</strong><small>${MOTION_DESCRIPTIONS[type]}</small></span></button>`).join('')}</div>`;
}
function followCard(editor,clip,locked){
  const p=clip.params,axes=p.followX&&p.followY?'both':p.followX?'x':p.followY?'y':'both',selected=[...editor.selectedUids].filter(uid=>!clip.targets.some(t=>t.uid===uid));
  const rows=clip.targets.map(t=>{const name=figureName(editor,t.uid);return `<div class="motion-target${name?'':' is-missing'}" data-follow-uid="${t.uid}"><span class="motion-target-name" title="${esc(name??'This figure is not in the animation any more')}">${icon('person')}${esc(name??'Missing figure')}</span>`+
    // With one figure there is nothing to weigh; a follow always keeps at least one figure.
    (clip.targets.length<2?'':`<input class="ui-slider" type="range" min="0" max="100" step="1" value="${Math.round(t.weight*100)}" style="--_p:${Math.round(t.weight*100)}%" data-follow-weight="${t.uid}" aria-label="Weight of ${esc(name??'missing figure')}" title="How much this figure pulls the shot" ${locked?'disabled':''}>`+
    `<button type="button" class="ui-icon-button" data-size="sm" data-follow-remove="${t.uid}" aria-label="Stop following ${esc(name??'missing figure')}" title="Stop following" ${locked?'disabled':''}>${icon('close')}</button>`)+'</div>';}).join('');
  return `<div class="motion-group"><div class="motion-group-head"><span>Following</span></div><div class="motion-targets">${rows}</div>`+
    `<button type="button" class="ui-button motion-follow-add" data-size="sm" data-variant="ghost" data-motion-action="follow-selected" ${locked||!selected.length?'disabled':''} title="${selected.length?'Add the selected figures':'Select figures on the canvas to add them'}">${icon('plus')}Follow selected figures</button></div>`+
    `<div class="motion-group"><div class="motion-group-head"><span>Camera</span></div>`+
    slider(clip,'strength','Amount',100,locked,'How strongly the camera follows')+
    slider(clip,'lag','Smoothness',30,locked,'How long the camera takes to catch up · 0 locks on')+
    slider(clip,'deadZone','Dead zone',60,locked,'Room the figure can move before the camera reacts')+
    slider(clip,'lookAhead','Look ahead',24,locked,'Leads the shot toward where the figure is going')+
    `<div class="ui-slider-row motion-slider-row"><span class="ui-slider-label">Direction</span><div class="ui-segmented motion-axes" data-size="sm" data-fill role="group" aria-label="Follow direction">${[['both','Both'],['x','Across'],['y','Up/down']].map(([value,label])=>`<button type="button" class="ui-segmented-item" data-motion-axes="${value}" aria-pressed="${axes===value}" ${locked?'disabled':''}>${label}</button>`).join('')}</div></div></div>`+
    `<div class="motion-group"><div class="motion-group-head"><span>Framing</span></div>`+
    slider(clip,'zoomFit','Auto zoom',100,locked,'Zooms to keep every followed figure in view')+
    (p.zoomFit>0?slider(clip,'padding','Margin',40,locked,'Space around the figures when zooming')+slider(clip,'maxZoom','Zoom limit',6,locked,'How far auto zoom may go in or out'):'')+
    `<div class="field-grid motion-offset">${parameter(clip,'offsetX',locked,'Offset X')}${parameter(clip,'offsetY',locked,'Offset Y')}</div>`+
    `<button type="button" class="ui-button motion-keep-framing" data-size="sm" data-variant="ghost" data-motion-action="keep-framing" ${locked?'disabled':''} title="Keep the figure where it is in the shot now">${icon('center')}Keep current framing</button></div>`;
}
function presetCard(clip,locked){
  const type=clip.type,noise=['shake','handheld'].includes(type);
  const main=type==='pulse'?[['zoom','Zoom',30]]:[['move','Intensity',type==='impact'?60:40],['roll','Rotation',10],...(type==='impact'?[['zoom','Zoom',30],['recovery','Settle',20]]:[['frequency','Speed',type==='shake'?20:4]])];
  const advanced=[...(type!=='pulse'?['moveX','moveY']:[]),...(type==='impact'?['direction','frequency']:[]),...(noise?['roughness','seed']:[]),...(type==='wobble'?['phase']:[])];
  return `<div class="motion-group">${slider(clip,'strength','Amount',100,locked,'Overall strength of this move')}${main.map(([key,label,soft])=>slider(clip,key,label,soft,locked)).join('')}</div>`+
    (advanced.length?`<details class="motion-advanced" data-section="motion-advanced-${esc(clip.id)}"><summary>${icon('chevron-right')}Fine tune</summary><div class="field-grid">${advanced.map(key=>parameter(clip,key,locked)).join('')}</div>${noise?`<button class="ui-button motion-randomize" data-size="sm" data-motion-action="randomize">${icon('rotate')}New variation</button>`:''}</details>`:'');
}
export function cameraMotionView(editor){
  const clips=editor.getCameraMotions(),locked=editor.getLayer('camera')?.locked,clip=clips.find(c=>c.id===editor._selectedCameraMotion)??clips[0];
  if(!clips.length)return `<section class="camera-motion-panel is-empty" aria-label="Camera motion"><p class="motion-intro">Add a move to the camera. It plays on top of your camera keys and stays editable.</p>${gallery(locked,false)}</section>`;
  const adding=Boolean(editor._cameraMotionAdding);
  return `<section class="camera-motion-panel" aria-label="Camera motion">`+
    `<div class="motion-list-head"><span>Camera moves</span><button type="button" class="ui-button" data-size="sm" data-variant="ghost" data-motion-action="toggle-add" aria-expanded="${adding}" ${locked?'disabled':''}>${icon(adding?'close':'plus')}${adding?'Close':'Add'}</button></div>`+
    (adding?gallery(locked,true):'')+
    `<div class="motion-list" role="list" aria-label="Motion clips">${clips.map(c=>`<div class="motion-list-row ${c.id===clip?.id?'selected':''}" role="listitem" data-kind="${c.type}">`+
      `<button class="motion-select" data-motion-select="${esc(c.id)}" aria-pressed="${c.id===clip?.id}">${icon(symbols[c.type])}<span class="motion-select-name">${CAMERA_MOTION_TYPES[c.type]}${c.type==='follow'?`<small>${esc(followSummary(editor,c))}</small>`:''}</span><small class="motion-select-range">${c.start+1}–${c.start+c.duration}</small></button>`+
      `<button class="icon-button motion-enable" data-motion-toggle="${esc(c.id)}" aria-label="${c.enabled?'Mute':'Enable'} ${CAMERA_MOTION_TYPES[c.type]}" aria-pressed="${c.enabled}" ${locked?'disabled':''}>${icon(c.enabled?'eye':'eye-off')}</button></div>`).join('')}</div>`+
    `<section class="motion-card" data-section="${esc(clip.id)}" data-motion-id="${esc(clip.id)}" data-kind="${clip.type}"><div class="motion-card-heading"><span class="motion-card-title">${icon(symbols[clip.type])}<strong>${CAMERA_MOTION_TYPES[clip.type]}</strong></span><div class="motion-actions">${action('preview','play','Preview this move')}${action('duplicate','duplicate','Duplicate',locked?'disabled':'')}${action('delete','trash','Delete',locked?'disabled':'')}</div></div>`+
    `<p class="motion-description">${MOTION_DESCRIPTIONS[clip.type]}</p>`+
    `<fieldset ${locked?'disabled':''}>`+
    `<div class="motion-group"><div class="motion-group-head"><span>Timing</span></div><div class="field-grid motion-timing">${field('Start','start',clip.start+1,'',`min="1" max="${10000001-clip.duration}" step="1"`,1,0,locked)}${field('Length','duration',clip.duration,'f',`min="1" max="${10000000-clip.start}" step="1"`,1,0,locked)}${parameter(clip,'fadeIn',locked,'Ease in')}${parameter(clip,'fadeOut',locked,'Ease out')}</div></div>`+
    (clip.type==='follow'?followCard(editor,clip,locked):presetCard(clip,locked))+
    `</fieldset>${motionGraphView()}</section>`+
    `<div class="motion-bake-row"><select class="inline-select" data-motion-bake-range aria-label="Bake range"><option value="all">All frames</option><option value="clip">This move's frames</option></select><button class="ui-button motion-bake" data-motion-action="bake" ${!clips.some(c=>c.enabled)||locked?'disabled':''} title="Turn every move into ordinary camera keys">${icon('diamond')}Bake to keys</button></div></section>`;
}
const parallaxAxis=(axis,value,disabled)=>`<div class="property-row" data-property-row="parallax_${axis}"><label class="field">${scrubLabel(axis.toUpperCase(),true,disabled)}<input data-parallax-field="${axis}" data-property="parallax_${axis}" data-property-value="${value*100}" data-property-step="1" data-property-precision="3" type="number" min="0" max="400" step="any" value="${Number((value*100).toFixed(4))}" aria-label="Parallax ${axis.toUpperCase()}"><small>%</small></label></div>`;
export function parallaxView(editor,id){
  const layer=editor.getLayer(id);if(layer?.kind!=='layer')return '';
  const p=layer.parallax??{enabled:false,linked:true,x:1,y:1},presets=[[.15,'Distant'],[.45,'Background'],[1,'Normal'],[1.4,'Foreground']],custom=!p.linked||!presets.some(([v])=>v===p.x);
  return `<details class="parallax-panel inspector-section" data-section="parallax" data-parallax-layer="${esc(id)}" ${p.enabled?'open':''}><summary class="parallax-heading">${icon('chevron-right')}<strong>Parallax</strong><label class="motion-switch" title="Enable parallax"><input data-parallax-field="enabled" type="checkbox" aria-label="Enable parallax" ${p.enabled?'checked':''} ${layer.locked?'disabled':''}><span></span></label></summary><fieldset ${layer.locked?'disabled':''}><div class="parallax-preset"><select class="inline-select" data-parallax-field="preset" aria-label="Parallax preset">${custom?'<option value="custom">Custom</option>':''}${presets.map(([v,label])=>`<option value="${v}" ${!custom&&p.x===v?'selected':''}>${label}</option>`).join('')}</select><button class="icon-button" data-parallax-reference title="Set reference from current frame" aria-label="Set reference from current frame">${icon('center')}</button></div><input data-parallax-field="movement" class="motion-slider" type="range" min="0" max="400" value="${p.x*100}" aria-label="Parallax movement"><div class="parallax-axes">${['x','y'].map((axis,i)=>`${i?`<label class="parallax-link ${p.linked?'linked':''}" title="Link axes"><input data-parallax-field="linked" type="checkbox" ${p.linked?'checked':''} aria-label="Link axes">${icon('link')}</label>`:''}${parallaxAxis(axis,p[axis],layer.locked)}`).join('')}</div></fieldset><details class="parallax-preview" data-section="parallax-preview"><summary>${icon('chevron-right')}Preview</summary><canvas class="parallax-monitor" data-parallax-monitor aria-label="Parallax camera preview"></canvas><div class="parallax-pan"><span>Pan</span><input data-parallax-preview class="motion-slider" type="range" min="-100" max="100" value="0" aria-label="Preview camera pan"></div></details></details>`;
}
export class CameraMotionControls {
  constructor(root,editor,{onError,onRender,onPreview,getResources,beforeEdit}={}){
    this.root=root;this.editor=editor;this.beforeEdit=beforeEdit;this.onRender=onRender;this.onError=onError;this.onPreview=onPreview;this.getResources=getResources;
    this.graph=new CameraMotionGraph(root,editor);
    root.addEventListener('click',event=>{const button=event.target.closest('[data-motion-action],[data-motion-select],[data-motion-toggle],[data-motion-add],[data-motion-axes],[data-follow-remove],[data-parallax-reference],[data-camera-tab]');if(!button)return;event.stopPropagation();this.run(()=>{
      if(button.dataset.motionAdd){this.beforeEdit?.();editor._cameraInspectorTab='motion';editor._cameraMotionAdding=false;editor._selectedCameraMotion=editor.addCameraMotion(button.dataset.motionAdd);this.onRender?.();return;}
      if(button.dataset.motionAxes||button.dataset.followRemove){
        this.beforeEdit?.();const id=button.closest('[data-motion-id]').dataset.motionId,clip=editor.getCameraMotions().find(c=>c.id===id),axes=button.dataset.motionAxes;
        if(axes)editor.setCameraMotion(id,{params:{followX:axes==='y'?0:1,followY:axes==='x'?0:1}});
        else editor.setCameraMotion(id,{targets:clip.targets.filter(t=>t.uid!==Number(button.dataset.followRemove))});
        this.onRender?.();return;
      }
      if(button.dataset.motionSelect){editor._selectedCameraMotion=button.dataset.motionSelect;this.onRender?.();return;}
      if(button.dataset.motionToggle){this.beforeEdit?.();const c=editor.getCameraMotions().find(c=>c.id===button.dataset.motionToggle);editor.setCameraMotion(c.id,{enabled:!c.enabled});this.onRender?.();return;}
      if(button.dataset.cameraTab){editor._cameraInspectorTab=button.dataset.cameraTab;this.onRender?.();return;}
      const id=button.closest('[data-motion-id]')?.dataset.motionId,action=button.dataset.motionAction;
      if(action!=='preview')this.beforeEdit?.();
      if(button.hasAttribute('data-parallax-reference')){const c=editor.evaluatedFrame.camera??{};editor.setLayerParallax(button.closest('[data-parallax-layer]').dataset.parallaxLayer,{reference:{x:c.x??0,y:c.y??0}});}
      else if(action==='toggle-add')editor._cameraMotionAdding=!editor._cameraMotionAdding;
      else if(action==='follow-selected'){const clip=editor.getCameraMotions().find(c=>c.id===id),known=new Set(clip.targets.map(t=>t.uid));editor.setCameraMotion(id,{targets:[...clip.targets,...[...editor.selectedUids].filter(uid=>!known.has(uid)).map(uid=>({uid,weight:1}))]});}
      else if(action==='keep-framing'){const clip=editor.getCameraMotions().find(c=>c.id===id),offset=followFramingOffset(editor.report,editor.evaluatedFrame,clip.targets);if(!offset)throw new Error('The followed figures are not in this frame.');editor.setCameraMotion(id,{params:{offsetX:Math.round(offset.x),offsetY:Math.round(offset.y)}});}
      else if(action==='delete')editor.deleteCameraMotion(id);
      else if(action==='duplicate')editor._selectedCameraMotion=editor.duplicateCameraMotion(id);
      else if(action==='randomize')editor.randomizeCameraMotion(id);
      else if(action==='bake'){button.disabled=true;button.textContent='Baking...';const selected=editor.getCameraMotions().find(c=>c.id===editor._selectedCameraMotion)??editor.getCameraMotions()[0],range=root.querySelector('[data-motion-bake-range]')?.value==='clip'?{start:selected.start,end:Math.min(editor.totalTicks,selected.start+selected.duration)}:{};return editor.bakeCameraMotion(range).finally(()=>this.onRender?.());}
      else if(action==='preview')this.onPreview?.(editor.getCameraMotions().find(c=>c.id===id));
      this.onRender?.();
    });});
    root.addEventListener('change',event=>{const input=event.target;if(input.matches('[data-follow-weight]')){event.stopPropagation();this.commitWeight(input);return;}if(!input.matches('[data-motion-field],[data-parallax-field]'))return;event.stopPropagation();this.commit(input);});
    root.addEventListener('input',event=>{const input=event.target;if(input.matches('[data-parallax-preview]')){this.sync(Number(input.value));return;}if(input.matches('[data-follow-weight]')){this.previewWeight(input);return;}if(input.matches('[data-motion-field]')&&['number','range'].includes(input.type))this.preview(input);else if(input.matches('[data-parallax-field]')&&['number','range'].includes(input.type))this.previewParallax(input);});
    root.addEventListener('keydown',event=>{const input=event.target;if(!input.matches('[data-motion-field],[data-parallax-field],[data-parallax-preview]'))return;event.stopPropagation();if(event.key==='Escape'){event.preventDefault();const original=this.active?.initial;this.cancel();if(original!==undefined)input.value=original;input.blur();this.onRender?.();}else if(event.key==='Enter'){event.preventDefault();this.commit(input);input.blur();}});
    root.addEventListener('toggle',event=>{if(event.target.matches('[data-section="parallax-preview"]'))this.sync();},true);
    editor.addEventListener('change',event=>{if(['document','history'].includes(event.detail?.kind)){this.active=null;this.pan=0;}});
  }
  run(fn){try{const result=fn();return result?.then?result.catch(error=>{this.onError?.(error);this.onRender?.();}):result;}catch(error){this.onError?.(error);this.onRender?.();}}
  handlesProperty(input){return Boolean(input?.matches('input[type="number"]:is([data-motion-field],[data-parallax-field]):not(:disabled)'));}
  propertyValue(input){
    const key=input.dataset.motionField;
    if(key){const clip=this.editor.getCameraMotions().find(c=>c.id===input.closest('[data-motion-id]').dataset.motionId),param=key==='move'?'moveX':key;return key==='start'?clip.start+1:key==='duration'?clip.duration:clip.params[param]*factorOf(param);}
    const layer=this.editor.getLayer(input.closest('[data-parallax-layer]').dataset.parallaxLayer);return (layer.parallax?.[input.dataset.parallaxField]??1)*100;
  }
  /** The app's shared PropertyControls owns pointer capture and keyboard input;
   * this owner retains only the small motion/layer transaction. */
  beginProperty(input){
    const parallax=input.hasAttribute('data-parallax-field'),id=input.closest(parallax?'[data-parallax-layer]':'[data-motion-id]').dataset[parallax?'parallaxLayer':'motionId'];
    return this.active={input,id,kind:parallax?'parallax':'motion',before:parallax?this.editor.report._styk.layers.byId[id]:this.editor.report._styk.cameraMotion,token:this.editor._documentToken,initial:String(this.propertyValue(input))};
  }
  previewProperty(edit,value){if(this.active!==edit||edit.token!==this.editor._documentToken)return;edit.input.value=String(value);if(edit.kind==='parallax')this.previewParallax(edit.input);else this.preview(edit.input);}
  commitProperty(edit,value){if(this.active!==edit||edit.token!==this.editor._documentToken)return;edit.input.value=String(value);this.commit(edit.input);}
  cancelProperty(edit){if(this.active===edit){this.cancel();this.sync();}}
  previewTimeline(clip){
    this.graph.preview(clip);
    const card=this.root.querySelector('[data-motion-id]');if(!card)return;
    const current=clip??this.editor.getCameraMotions().find(c=>c.id===card.dataset.motionId);
    if(!current||current.id!==card.dataset.motionId)return;
    for(const [key,value] of [['start',current.start+1],['duration',current.duration]]){
      const input=card.querySelector(`[data-motion-field="${key}"]`);input.value=String(value);input.dataset.propertyValue=String(value);
    }
  }
  patch(input){const key=input.dataset.motionField,value=input.type==='checkbox'?input.checked:Number(input.value);if(input.value===''||!input.validity.valid)throw new Error('Enter a value within the allowed range.');
    // Intensity moves both axes together; Fine tune keeps them separately editable.
    return key==='enabled'?{enabled:value}:key==='start'?{start:value-1}:key==='duration'?{duration:value}:key==='move'?{params:{moveX:value,moveY:value}}:{params:{[key]:value/factorOf(key)}};}
  /** The slider and the typed value of one control show the same number while either moves. */
  mirror(input){
    const card=input.closest('[data-motion-id]');if(!card)return;
    for(const other of card.querySelectorAll(`[data-motion-field="${input.dataset.motionField}"]`)){
      if(other===input)continue;other.value=input.value;
      if(other.type==='range'){if(Number(input.value)>Number(other.max))other.max=input.value;other.style.setProperty('--_p',`${(Number(other.value)-Number(other.min))/Math.max(1e-9,Number(other.max)-Number(other.min))*100}%`);}
    }
    if(input.type==='range')input.style.setProperty('--_p',`${(Number(input.value)-Number(input.min))/Math.max(1e-9,Number(input.max)-Number(input.min))*100}%`);
  }
  weights(input){const card=input.closest('[data-motion-id]'),clip=this.editor.getCameraMotions().find(c=>c.id===card.dataset.motionId),uid=Number(input.dataset.followWeight),weight=Number(input.value)/100;input.style.setProperty('--_p',`${input.value}%`);return {id:clip.id,targets:clip.targets.map(t=>t.uid===uid?{...t,weight}:t)};}
  previewWeight(input){this.run(()=>{
    const editor=this.editor,{id,targets}=this.weights(input);if(!this.active)this.beforeEdit?.();
    this.active??={input,id,before:editor.report._styk.cameraMotion,token:editor._documentToken,initial:input.defaultValue};
    const clips=this.active.before.clips.map(c=>c.id===id?{...c,targets}:c);validateCameraMotion({version:1,clips});editor.report._styk.cameraMotion={version:1,clips};editor._invalidate({retainGeometry:true});editor._emit('edit',{live:true,camera:true,cameraMotion:true});
  });}
  commitWeight(input){this.run(()=>{if(!this.active)this.beforeEdit?.();const {id,targets}=this.weights(input);this.cancel();this.editor.setCameraMotion(id,{targets});this.onRender?.();});}
  preview(input){this.run(()=>{
    const id=input.closest('[data-motion-id]').dataset.motionId,patch=this.patch(input),editor=this.editor;
    this.mirror(input);
    if(!this.active)this.beforeEdit?.();
    this.active??={input,id,before:editor.report._styk.cameraMotion,token:editor._documentToken,initial:input.defaultValue};
    const clips=this.active.before.clips.map(c=>c.id===id?{...c,...patch,params:{...c.params,...patch.params}}:c);
    validateCameraMotion({version:1,clips});editor.report._styk.cameraMotion={version:1,clips};editor._invalidate({retainGeometry:true});editor._emit('edit',{live:true,camera:true,cameraMotion:true});
  });}
  previewParallax(input){this.run(()=>{
    if(!input.value||!input.validity.valid)return;
    const id=input.closest('[data-parallax-layer]').dataset.parallaxLayer,editor=this.editor,layer=editor.report._styk.layers.byId[id],key=input.dataset.parallaxField,value=Number(input.value)/100;
    if(layer.locked)return;
    if(!this.active)this.beforeEdit?.();
    this.active??={kind:'parallax',input,id,before:layer,token:editor._documentToken,initial:input.defaultValue};
    const c=editor.evaluatedFrame.camera??{},p={enabled:false,linked:true,x:1,y:1,reference:{x:c.x??0,y:c.y??0},...this.active.before.parallax};
    if(key==='movement'||p.linked){p.x=p.y=value;}else p[key]=value;
    validateParallax(p);editor.report._styk.layers.byId[id]={...layer,parallax:p};editor._layerChanged();editor._invalidate({retainGeometry:true});editor._emit('edit',{live:true,parallax:true,layers:true});this.sync();
  });}
  cancel(){const edit=this.active;if(!edit)return;this.active=null;if(edit.token!==this.editor._documentToken)return;if(edit.kind==='parallax'){this.editor.report._styk.layers.byId[edit.id]=edit.before;this.editor._layerChanged();}else this.editor.report._styk.cameraMotion=edit.before;this.editor._invalidate({timing:true,retainGeometry:true});this.editor._emit('edit',{live:true,camera:true});}
  commit(input){this.run(()=>{if(!this.active)this.beforeEdit?.();const id=input.closest('[data-motion-id]')?.dataset.motionId;this.cancel();if(id)this.editor.setCameraMotion(id,this.patch(input));else{
    const key=input.dataset.parallaxField;if(!key||input.value==='custom')return;if(input.type==='number'&&(!input.value||!input.validity.valid))throw new Error('Enter a valid parallax response.');const value=input.type==='checkbox'?input.checked:key==='preset'?Number(input.value):Number(input.value)/100;
    this.editor.setLayerParallax(input.closest('[data-parallax-layer]').dataset.parallaxLayer,key==='preset'?{x:value,y:value,linked:true,enabled:true}:key==='movement'?{x:value,y:value}:{[key]:value});
  }this.onRender?.();});}
  sync(pan=this.pan??0){this.graph.update();if(this.graph.previewClip)this.previewTimeline(this.graph.previewClip);this.pan=pan;const panel=this.root.querySelector('[data-parallax-layer]'),p=panel&&this.editor.getLayer(panel.dataset.parallaxLayer)?.parallax;
    if(p)for(const input of panel.querySelectorAll('input:is([type="number"],[type="range"])[data-parallax-field]'))if(input!==this.active?.input){const value=p[input.dataset.parallaxField==='movement'?'x':input.dataset.parallaxField]*100;input.value=String(value);input.dataset.propertyValue=String(value);}
    const canvas=this.root.querySelector('[data-parallax-monitor]');if(!cameraMonitorVisible(canvas))return;
    const editor=this.editor,frame=editor.evaluatedFrame,c=frame.camera??{};
    drawCameraMonitor(canvas,{report:editor.report,frame:{...frame,camera:{...c,is_default:false,x:(c.x??0)+pan*editor.report.canvas_width/200}},geometry:editor.geometry,resources:this.getResources?.(),onError:this.onError});
  }
}
