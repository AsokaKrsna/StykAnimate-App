import {CAMERA_MOTION_TYPES,MOTION_PARAMETERS,validateCameraMotion} from './camera-motion.mjs';
import {CameraMotionGraph,motionGraphView} from './camera-motion-graph.mjs';
import {drawCameraMonitor,cameraMonitorVisible} from './camera-monitor.mjs';
import {validateParallax} from './layer-parallax.mjs';
import {icon} from './icons.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={shake:'activity',handheld:'camera',wobble:'rotate',impact:'center',pulse:'zoom-in'};
const action=(name,symbol,label,extra='')=>`<button class="icon-button" data-motion-action="${name}" title="${label}" aria-label="${label}" ${extra}>${icon(symbol)}</button>`;
const scrubLabel=(label,enabled=true,disabled=false)=>`<span ${enabled?`class="property-scrub" data-property-scrub tabindex="${disabled?-1:0}" role="button" ${disabled?'aria-disabled="true"':''} aria-label="Scrub ${label}" title="Drag to adjust · Shift: fine · Alt: extra fine"`:''}>${label}</span>`;
const field=(label,key,value,unit='',extra='',step=1,precision=0,disabled=false)=>`<div class="property-row" data-property-row="motion_${key}"><label class="field motion-field">${scrubLabel(label,key!=='seed',disabled)}<input type="number" data-motion-field="${key}" data-property="motion_${key}" data-property-value="${value}" data-property-step="${step}" data-property-precision="${precision}" value="${Number(value.toFixed(4))}" aria-label="${label}" ${extra}><small>${unit}</small></label></div>`;
function parameter(clip,key,disabled){const [label,min,max,step,unit]=MOTION_PARAMETERS[key],factor=unit==='%'?100:1,whole=['seed','fadeIn','fadeOut'].includes(key);return field(label,key,clip.params[key]*factor,unit==='frames'?'f':unit,`min="${min*factor}" max="${max*factor}" step="${whole?1:'any'}"`,step*factor,whole?0:3,disabled);}
const parallaxAxis=(axis,value,disabled)=>`<div class="property-row" data-property-row="parallax_${axis}"><label class="field">${scrubLabel(axis.toUpperCase(),true,disabled)}<input data-parallax-field="${axis}" data-property="parallax_${axis}" data-property-value="${value*100}" data-property-step="1" data-property-precision="3" type="number" min="0" max="400" step="any" value="${Number((value*100).toFixed(4))}" aria-label="Parallax ${axis.toUpperCase()}"><small>%</small></label></div>`;
export function cameraMotionView(editor){
  const clips=editor.getCameraMotions(),locked=editor.getLayer('camera')?.locked,selected=clips.find(c=>c.id===editor._selectedCameraMotion)??clips[0];
  const clip=selected,noise=clip&&['shake','handheld'].includes(clip.type),controls=clip?(clip.type==='pulse'?['zoom']:['moveX','moveY','roll',...(clip.type==='impact'?['zoom','direction','recovery']:['frequency'])]):[];
  return `<section class="camera-motion-panel" aria-label="Camera motion"><div class="motion-add"><select class="inline-select" data-motion-preset aria-label="Motion preset">${Object.entries(CAMERA_MOTION_TYPES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select><button class="button" data-motion-action="add" ${locked?'disabled':''}>${icon('plus')}Add motion</button></div>
    <div class="motion-list" role="list" aria-label="Motion clips">${clips.map(c=>`<div class="motion-list-row ${c.id===clip?.id?'selected':''}" role="listitem"><button class="icon-button motion-enable" data-motion-toggle="${esc(c.id)}" aria-label="${c.enabled?'Mute':'Enable'} ${CAMERA_MOTION_TYPES[c.type]}" aria-pressed="${c.enabled}" ${locked?'disabled':''}>${icon(c.enabled?'eye':'eye-off')}</button><button class="motion-select" data-motion-select="${esc(c.id)}" aria-pressed="${c.id===clip?.id}">${icon(symbols[c.type])}<span>${CAMERA_MOTION_TYPES[c.type]}</span><small>${c.start+1}–${c.start+c.duration}</small></button></div>`).join('')}</div>
    ${clip?`<section class="motion-card" data-section="${esc(clip.id)}" data-motion-id="${esc(clip.id)}"><div class="motion-card-heading"><strong>${CAMERA_MOTION_TYPES[clip.type]}</strong><div class="motion-actions">${action('preview','play','Preview motion')}${action('duplicate','duplicate','Duplicate motion',locked?'disabled':'')}${action('delete','trash','Delete motion',locked?'disabled':'')}</div></div><fieldset ${locked?'disabled':''}><div class="field-grid">${field('Start','start',clip.start+1,'',`min="1" max="${10000001-clip.duration}" step="1"`,1,0,locked)}${field('Duration','duration',clip.duration,'f',`min="1" max="${10000000-clip.start}" step="1"`,1,0,locked)}${parameter(clip,'strength',locked)}</div></fieldset>${motionGraphView()}<fieldset ${locked?'disabled':''}><div class="field-grid">${controls.map(key=>parameter(clip,key,locked)).join('')}</div><details class="motion-advanced" data-section="motion-advanced-${esc(clip.id)}"><summary>${icon('chevron-right')}Advanced</summary><div class="field-grid">${[...(clip.type==='impact'?['frequency']:[]),...(noise?['roughness','seed']:[]),...(clip.type==='wobble'?['phase']:[]),'fadeIn','fadeOut'].map(key=>parameter(clip,key,locked)).join('')}</div>${noise?`<button class="button motion-randomize" data-motion-action="randomize">${icon('rotate')}Randomize</button>`:''}</details></fieldset></section><div class="motion-bake-row"><select class="inline-select" data-motion-bake-range aria-label="Bake range"><option value="all">All frames</option><option value="clip">Clip range</option></select><button class="button motion-bake" data-motion-action="bake" ${!clips.some(c=>c.enabled)||locked?'disabled':''}>${icon('diamond')}Bake to keys</button></div>`:''}</section>`;
}
export function parallaxView(editor,id){
  const layer=editor.getLayer(id);if(layer?.kind!=='layer')return '';
  const p=layer.parallax??{enabled:false,linked:true,x:1,y:1},presets=[[.15,'Distant'],[.45,'Background'],[1,'Normal'],[1.4,'Foreground']],custom=!p.linked||!presets.some(([v])=>v===p.x);
  return `<details class="parallax-panel inspector-section" data-section="parallax" data-parallax-layer="${esc(id)}" ${p.enabled?'open':''}><summary class="parallax-heading">${icon('chevron-right')}<strong>Parallax</strong><label class="motion-switch" title="Enable parallax"><input data-parallax-field="enabled" type="checkbox" aria-label="Enable parallax" ${p.enabled?'checked':''} ${layer.locked?'disabled':''}><span></span></label></summary><fieldset ${layer.locked?'disabled':''}><div class="parallax-preset"><select class="inline-select" data-parallax-field="preset" aria-label="Parallax preset">${custom?'<option value="custom">Custom</option>':''}${presets.map(([v,label])=>`<option value="${v}" ${!custom&&p.x===v?'selected':''}>${label}</option>`).join('')}</select><button class="icon-button" data-parallax-reference title="Set reference from current frame" aria-label="Set reference from current frame">${icon('center')}</button></div><input data-parallax-field="movement" class="motion-slider" type="range" min="0" max="400" value="${p.x*100}" aria-label="Parallax movement"><div class="parallax-axes">${['x','y'].map((axis,i)=>`${i?`<label class="parallax-link ${p.linked?'linked':''}" title="Link axes"><input data-parallax-field="linked" type="checkbox" ${p.linked?'checked':''} aria-label="Link axes">${icon('link')}</label>`:''}${parallaxAxis(axis,p[axis],layer.locked)}`).join('')}</div></fieldset><details class="parallax-preview" data-section="parallax-preview"><summary>${icon('chevron-right')}Preview</summary><canvas class="parallax-monitor" data-parallax-monitor aria-label="Parallax camera preview"></canvas><div class="parallax-pan"><span>Pan</span><input data-parallax-preview class="motion-slider" type="range" min="-100" max="100" value="0" aria-label="Preview camera pan"></div></details></details>`;
}
export class CameraMotionControls {
  constructor(root,editor,{onError,onRender,onPreview,getResources,beforeEdit}={}){
    this.root=root;this.editor=editor;this.beforeEdit=beforeEdit;this.onRender=onRender;this.onError=onError;this.onPreview=onPreview;this.getResources=getResources;
    this.graph=new CameraMotionGraph(root,editor);
    root.addEventListener('click',event=>{const button=event.target.closest('[data-motion-action],[data-motion-select],[data-motion-toggle],[data-parallax-reference],[data-camera-tab]');if(!button)return;event.stopPropagation();this.run(()=>{
      if(button.dataset.motionSelect){editor._selectedCameraMotion=button.dataset.motionSelect;this.onRender?.();return;}
      if(button.dataset.motionToggle){this.beforeEdit?.();const c=editor.getCameraMotions().find(c=>c.id===button.dataset.motionToggle);editor.setCameraMotion(c.id,{enabled:!c.enabled});this.onRender?.();return;}
      if(button.dataset.cameraTab){editor._cameraInspectorTab=button.dataset.cameraTab;this.onRender?.();return;}
      const id=button.closest('[data-motion-id]')?.dataset.motionId,action=button.dataset.motionAction;
      if(action!=='preview')this.beforeEdit?.();
      if(button.hasAttribute('data-parallax-reference')){const c=editor.evaluatedFrame.camera??{};editor.setLayerParallax(button.closest('[data-parallax-layer]').dataset.parallaxLayer,{reference:{x:c.x??0,y:c.y??0}});}
      else if(action==='add'){editor._cameraInspectorTab='motion';editor._selectedCameraMotion=editor.addCameraMotion(root.querySelector('[data-motion-preset]').value);}
      else if(action==='delete')editor.deleteCameraMotion(id);
      else if(action==='duplicate')editor._selectedCameraMotion=editor.duplicateCameraMotion(id);
      else if(action==='randomize')editor.randomizeCameraMotion(id);
      else if(action==='bake'){button.disabled=true;button.textContent='Baking...';const selected=editor.getCameraMotions().find(c=>c.id===editor._selectedCameraMotion)??editor.getCameraMotions()[0],range=root.querySelector('[data-motion-bake-range]')?.value==='clip'?{start:selected.start,end:Math.min(editor.totalTicks,selected.start+selected.duration)}:{};return editor.bakeCameraMotion(range).finally(()=>this.onRender?.());}
      else if(action==='preview')this.onPreview?.(editor.getCameraMotions().find(c=>c.id===id));
      this.onRender?.();
    });});
    root.addEventListener('change',event=>{const input=event.target;if(!input.matches('[data-motion-field],[data-parallax-field]'))return;event.stopPropagation();this.commit(input);});
    root.addEventListener('input',event=>{const input=event.target;if(input.matches('[data-parallax-preview]')){this.sync(Number(input.value));return;}if(input.matches('[data-motion-field]')&&input.type==='number')this.preview(input);else if(input.matches('[data-parallax-field]')&&['number','range'].includes(input.type))this.previewParallax(input);});
    root.addEventListener('keydown',event=>{const input=event.target;if(!input.matches('[data-motion-field],[data-parallax-field],[data-parallax-preview]'))return;event.stopPropagation();if(event.key==='Escape'){event.preventDefault();const original=this.active?.initial;this.cancel();if(original!==undefined)input.value=original;input.blur();this.onRender?.();}else if(event.key==='Enter'){event.preventDefault();this.commit(input);input.blur();}});
    root.addEventListener('toggle',event=>{if(event.target.matches('[data-section="parallax-preview"]'))this.sync();},true);
    editor.addEventListener('change',event=>{if(['document','history'].includes(event.detail?.kind)){this.active=null;this.pan=0;}});
  }
  run(fn){try{const result=fn();return result?.then?result.catch(error=>{this.onError?.(error);this.onRender?.();}):result;}catch(error){this.onError?.(error);this.onRender?.();}}
  handlesProperty(input){return Boolean(input?.matches('input[type="number"]:is([data-motion-field],[data-parallax-field]):not(:disabled)'));}
  propertyValue(input){
    const key=input.dataset.motionField;
    if(key){const clip=this.editor.getCameraMotions().find(c=>c.id===input.closest('[data-motion-id]').dataset.motionId);return key==='start'?clip.start+1:key==='duration'?clip.duration:clip.params[key]*(MOTION_PARAMETERS[key][4]==='%'?100:1);}
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
  patch(input){const key=input.dataset.motionField,value=input.type==='checkbox'?input.checked:Number(input.value);if(input.value===''||!input.validity.valid)throw new Error('Enter a value within the allowed range.');return key==='enabled'?{enabled:value}:key==='start'?{start:value-1}:key==='duration'?{duration:value}:{params:{[key]:value/(MOTION_PARAMETERS[key][4]==='%'?100:1)}};}
  preview(input){this.run(()=>{
    const id=input.closest('[data-motion-id]').dataset.motionId,patch=this.patch(input),editor=this.editor;
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
