import {objectBounds,cameraMatrix,worldToScreen} from './renderer-geometry.mjs';
import {VFX_REGISTRY} from './vfx.mjs';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
/** Ephemeral canvas controls. A drag edits one stack through the normal history transaction. */
export class VfxGizmos {
 constructor({canvas,inspector,editor,getOptions,onChange,onError}){
  Object.assign(this,{canvas,inspector,editor,getOptions,onChange,onError});this.abort=new AbortController();this.handles=[];
  for(const [type,handler] of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel'],['lostpointercapture','cancel']])canvas.addEventListener(type,e=>{try{this[handler](e);}catch(error){this.cancel();onError(error);}},{capture:true,signal:this.abort.signal});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopImmediatePropagation();this.cancel();}},{capture:true,signal:this.abort.signal});
 }
 get active(){return Boolean(this.drag);}
 control(){
  if(!this.inspector.visible)return null;
  const selected=this.inspector.selectedEffect();if(!selected||!selected.effect.enabled)return null;
  const options=this.getOptions();if(options.playing||options.vfxEnabled===false)return null;
  const {target,effect}=selected,layer=this.editor.getLayer(target.kind==='scene'?'scene':this.editor.layerForUid(target.uid));if(layer?.locked)return null;
  let bounds,unit=1,map,inverse;
  if(target.kind==='scene'){
   bounds={x:0,y:0,width:options.report.canvas_width,height:options.report.canvas_height};const [a,b,c,d,e,f]=cameraMatrix({...options,view:{scale:1},cameraEnabled:true}),det=a*d-b*c;
   map=p=>({x:(d*(p.x-e)-c*(p.y-f))/det,y:(-b*(p.x-e)+a*(p.y-f))/det});inverse=p=>({x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f});
  }else{
   let items=options.geometry.drawables.filter(item=>item.obj.unique_id===target.uid);if(target.kind==='segment')items=items.filter(item=>item.seg?.segment_id===target.handleId&&item.fig?.figure_type_id===target.figureTypeId);
   if(!items.length)return null;bounds=objectBounds(items,{...options.resources,vfxBounds:false});unit=Math.max(.000001,Math.abs(items[0].obj.scale??1));map=p=>p;inverse=p=>p;
  }
  const [a,b,c,d,e,f]=cameraMatrix(options),det=a*d-b*c;
  const project=p=>worldToScreen(map(p),options),unproject=p=>inverse({x:(d*(p.x-e)-c*(p.y-f))/det,y:(-b*(p.x-e)+a*(p.y-f))/det});
  return {...selected,options,bounds,unit,project,unproject};
 }
 draw(context){
  this.handles=[];const control=this.control();this.controlState=control;if(!control)return;
  const {effect:{type,params:p},bounds:b,unit,project}=control,center={x:b.x+b.width*(p.centerX??.5),y:b.y+b.height*(p.centerY??.5)},angle=(p.angle??0)*Math.PI/180;
  const add=(kind,point,label)=>this.handles.push({kind,point,screen:project(point),label});
  const direction=(distance,a=angle)=>({x:center.x+Math.cos(a)*distance,y:center.y+Math.sin(a)*distance});
  if(['vignette','shockwave'].includes(type)||type==='blur'&&p.mode>=2)add('center',center,'Center');
  if(['glow','bloom'].includes(type)||type==='blur'&&p.mode===0)add('radius',direction(p.radius*unit,0),'Radius');
  if(type==='outline')add('width',{x:b.x+b.width+p.width*unit,y:center.y},'Width');
  if(type==='shadow')add('offset',{x:center.x+p.offsetX*unit,y:center.y+p.offsetY*unit},'Offset');
  if(type==='blur'&&p.mode>0)add('blur',direction(p.radius*unit),'Blur');
  if(type==='rgbSplit')add('direction',direction(p.amount*unit),'Amount / angle');
  if(type==='wave'){add('wave',direction(p.wavelength*unit/2),'Wavelength / angle');add('strength',direction(p.strength*unit,angle+Math.PI/2),'Strength');}
  if(type==='shockwave')add('radius',direction(p.radius*unit,0),'Radius');
  if(type==='vignette')add('vignette',direction(b.width*.5*p.radius*p.aspect,0),'Radius');
  if(type==='pixelate'){const origin={x:b.x+p.offsetX*unit,y:b.y+p.offsetY*unit};add('grid',origin,'Grid');add('cell',{x:origin.x+p.size*unit,y:origin.y+(p.linked?p.size:p.sizeY)*unit},'Cell size');}
  if(type==='noise')add('grain',direction(p.size*unit,0),'Grain size');
  if(type==='dissolve')add('progress',{x:b.x+b.width*p.progress,y:b.y+b.height},'Progress');
  if(type==='lightSweep')add('sweep',{x:center.x+Math.cos(angle)*(p.position-.5)*b.width,y:center.y+Math.sin(angle)*(p.position-.5)*b.height},'Position');
  if(type==='crt')add('curvature',{x:b.x+b.width*(1-p.curvature),y:center.y},'Curvature');
  if(!this.handles.length)return;const base=project(center);context.save();context.lineWidth=1;context.setLineDash([4,4]);context.strokeStyle='#4eb8ff';
  for(const h of this.handles){context.beginPath();context.moveTo(base.x,base.y);context.lineTo(h.screen.x,h.screen.y);context.stroke();}
  context.setLineDash([]);for(const h of this.handles){const active=this.drag?.handle.kind===h.kind;context.beginPath();context.arc(h.screen.x,h.screen.y,active?7:5.5,0,Math.PI*2);context.fillStyle=active?'#109fff':'#fff';context.fill();context.strokeStyle='#087fcc';context.lineWidth=2;context.stroke();}
  if(this.drag){const h=this.handles.find(h=>h.kind===this.drag.handle.kind);if(h){context.font='11px Segoe UI';const width=context.measureText(h.label).width+14;context.fillStyle='#173349';context.fillRect(h.screen.x+12,h.screen.y-13,width,22);context.fillStyle='#fff';context.fillText(h.label,h.screen.x+19,h.screen.y+2);}}
  context.restore();
 }
 point(event){const rect=this.canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
 down(event){if(event.button!==0)return;const point=this.point(event),handle=[...this.handles].reverse().find(h=>Math.hypot(h.screen.x-point.x,h.screen.y-point.y)<11);if(!handle)return;const control=this.control();if(!control)return;event.preventDefault();event.stopImmediatePropagation();this.inspector.commit();this.inspector.beforeEdit();const stack=structuredClone(this.editor.vfxEffects(control.target));this.editor.beginAnimationEdit(control.target,'vfxStack',{exactTarget:true});this.drag={control,handle,stack,start:control.unproject(point),pointerId:event.pointerId};this.canvas.setPointerCapture(event.pointerId);this.onChange();}
 move(event){if(!this.drag)return;event.preventDefault();event.stopImmediatePropagation();const {control,handle,stack,start}=this.drag,{bounds:b,unit,effect}=control,p={...effect.params},current=control.unproject(this.point(event)),at={x:handle.point.x+current.x-start.x,y:handle.point.y+current.y-start.y},center={x:b.x+b.width*(p.centerX??.5),y:b.y+b.height*(p.centerY??.5)},dx=at.x-center.x,dy=at.y-center.y,distance=Math.hypot(dx,dy)/unit;
  const set=(name,value)=>{const d=VFX_REGISTRY[effect.type].params[name];p[name]=clamp(value,d.min,d.max);};
  if(handle.kind==='center'){set('centerX',(at.x-b.x)/b.width);set('centerY',(at.y-b.y)/b.height);}
  if(handle.kind==='radius')set('radius',distance);
  if(handle.kind==='width')set('width',(at.x-b.x-b.width)/unit);
  if(handle.kind==='offset'){set('offsetX',dx/unit);set('offsetY',dy/unit);}
  if(handle.kind==='blur'){set('radius',distance);if(p.mode===1)set('angle',Math.atan2(dy,dx)*180/Math.PI);}
  if(handle.kind==='direction'){set('amount',distance);set('angle',Math.atan2(dy,dx)*180/Math.PI);}
  if(handle.kind==='wave'){set('wavelength',distance*2);set('angle',Math.atan2(dy,dx)*180/Math.PI);}
  if(handle.kind==='strength')set('strength',distance);
  if(handle.kind==='vignette')set('radius',Math.abs(dx)/(b.width*.5*p.aspect));
  if(handle.kind==='grid'){set('offsetX',(at.x-b.x)/unit);set('offsetY',(at.y-b.y)/unit);}
  if(handle.kind==='cell'){set('size',(at.x-b.x)/unit-p.offsetX);if(!p.linked)set('sizeY',(at.y-b.y)/unit-p.offsetY);}
  if(handle.kind==='grain')set('size',distance);
  if(handle.kind==='progress')set('progress',(at.x-b.x)/b.width);
  if(handle.kind==='sweep'){const angle=p.angle*Math.PI/180;set('position',.5+dx/b.width*Math.cos(angle)+dy/b.height*Math.sin(angle));}
  if(handle.kind==='curvature')set('curvature',1-(at.x-b.x)/b.width);
  const next=stack.map(item=>item.id===effect.id?{...item,version:2,params:p}:item);this.editor.previewAnimationEdit(next);this.onChange();
 }
 up(event){if(!this.drag)return;event?.preventDefault();event?.stopImmediatePropagation();const id=this.drag.pointerId;this.drag=null;this.editor.commitAnimationEdit();if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);this.inspector.sync();this.onChange();}
 cancel(){if(!this.drag)return;const id=this.drag.pointerId;this.drag=null;this.editor.cancelAnimationEdit();if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);this.inspector.sync();this.onChange();}
 destroy(){this.cancel();this.abort.abort();}
}
