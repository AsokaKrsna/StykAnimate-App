import {BRUSH_PRESETS} from './drawing-view.mjs';
import {DrawingStroke,pixelChanges,lassoMask,writeTile} from './drawing-pixels.mjs';
import {drawingMetadata,drawingExpansion,expandedDrawingFigure,isDrawingLayer,drawingMatrix,inversePoint,transformPoint} from './drawing-model.mjs';
import {drawingBarrier} from './drawing-resources.mjs';
import {buildGeometry,drawGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {screenToWorld,worldToScreen} from './renderer-geometry.mjs';

const pointerSample=e=>({clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,pointerType:e.pointerType,timeStamp:e.timeStamp,button:e.button,buttons:e.buttons});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const brushKeys=['preset','size','opacity','flow','hardness','pressureSize','pressureOpacity','sizeCurve','opacityCurve','stabilization'];
export class DrawingController {
  constructor({editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard}) {
    Object.assign(this,{editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard,settings:{preset:'ink',size:8,color:'#252525',opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,sizeCurve:1,opacityCurve:1,stabilization:0,resolution:2,length:1,tolerance:16,expansion:1,gap:0,sampleAll:false},sequence:0});
    this.panel=document.getElementById('inspector');
    const events=this.events=new AbortController(),opts={signal:events.signal};
    this.panel.addEventListener('click',event=>{const preset=event.target.closest('[data-draw-preset]'),action=event.target.closest('[data-draw-action]');if(preset){this.finish();Object.assign(this.settings,BRUSH_PRESETS.find(p=>p.id===preset.dataset.drawPreset),{preset:preset.dataset.drawPreset});this.onUI();}if(action)this.run(()=>this.action(action.dataset.drawAction));},opts);
    this.panel.addEventListener('change',event=>{if(event.target.dataset.drawSetting)this.run(()=>this.change(event));},opts);
    for(const [name,handler] of [['pointerdown',e=>this.down(e)],['pointermove',e=>this.move(e)],['pointerup',e=>this.up(e)],['pointercancel',e=>this.up(e,true)],['lostpointercapture',e=>this.up(e,true)]])overlay.addEventListener(name,event=>{
      if(!this.active)return;
      // The shared viewport owns the entire pan gesture, including moves whose
      // button is -1 and release after Space has already been lifted.
      if(state.drag?.kind==='pan')return;
      if(event.type==='pointerdown'&&(event.button===1||state.space||this.tool==='pan')){this.finish();return;}
      if(!this.gesture&&(this.tool==='pan'||state.space||event.button===1||event.buttons&4))return;
      if(event.type==='pointerdown'&&(event.button!==0&&event.button!==5||state.playing))return;
      event.stopImmediatePropagation();event.preventDefault();this.run(()=>handler(event));
    },{...opts,capture:true});
    window.addEventListener('blur',()=>this.cancel(),opts);
    editor.addEventListener('change',event=>{
      const kind=event.detail.kind;
      if(kind==='document'){this.cancel();this.selection=null;this.bind();}
      if(['seek','history'].includes(kind)){this.cancel();this.cancelSelection();}
      if(this.active){this.sync();this.prepareVisible();}
    },opts);
    // Navigation begins before the editor changes its active layer or playhead.
    document.addEventListener('pointerdown',event=>{if(this.gesture&&!overlay.contains(event.target))this.finish();if(this.selection&&event.target.closest?.('.layer-timeline,.sheet-filmstrip'))this.run(()=>this.applySelection());},{...opts,capture:true});
    this.bind();
  }
  bind(){const owner=this.editor.drawingResources;owner.onChange=()=>{if(this.surfaceVersion!==owner.surfaceVersion){this.surfaceVersion=owner.surfaceVersion;if(this.state.renderer){this.state.renderer.lastGeometry=null;this.state.renderer.clearArtwork?.();this.state.renderer.clearOnionArtwork?.();}}this.onRender();};owner.onError=this.onError;this.owner=owner;}
  run(operation){try{const result=operation();if(result?.catch)result.catch(error=>{this.cancel();if(error.name!=='AbortError')this.onError(error);});return result;}catch(error){this.cancel();this.onError(error);}}
  enter(){if(this.active)return;this.beforeEdit();this.prior={handles:this.state.handles,tool:this.state.tool,rotation:this.state.view.rotation??0};this.active=true;this.state.handles=false;this.state.tool='drawing-brush';this.state.drawing=true;
    const layers=this.editor.layers.filter(layer=>isDrawingLayer(layer)&&!layer.locked&&layer.visible),target=layers.find(l=>l.id===this.editor.activeLayerId)||layers.find(l=>l.id===this.lastLayer)||layers.at(-1);if(target){this.editor.selectSheetLayer(target.id);this.state.selectedTrackId=target.id;}this.sync();this.prepareVisible();this.onUI();this.onRender();}
  exit(){if(!this.active)return;this.finish();this.applySelection();this.active=false;this.state.drawing=false;Object.assign(this.state,{handles:this.prior.handles,tool:this.prior.tool});this.state.view.rotation=this.prior.rotation;this.onUI();this.onRender();}
  get tool(){return this.state.tool==='hand'?'pan':this.state.tool.replace('drawing-','');}
  set tool(value){this.setTool(value);}
  setTool(value){this.finish();if(this.selection&&value!=='lasso')this.applySelection();
    // Brush and eraser remember their own tip, pressure and size settings.
    this.tips??={eraser:{preset:null,size:24,opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,sizeCurve:1,opacityCurve:1,stabilization:0}};
    if(['brush','eraser'].includes(this.tool))this.tips[this.tool]=Object.fromEntries(brushKeys.map(key=>[key,this.settings[key]]));
    if(this.tips[value])Object.assign(this.settings,this.tips[value]);
    this.state.tool=value==='pan'?'hand':'drawing-'+value;if(value==='transform'){try{const t=this.editor.drawingTarget();if(t.object)this.editor.select(t.object.unique_id);}catch{}}this.sync();this.onUI();this.onRender();}
  get pixelClipboard(){return this.editor._drawingPixelClipboard;}
  get exposureLabel(){try{const t=this.editor.drawingTarget();return `${t.figure?'Drawing':'Blank'} · frames ${t.key.tick+1}–${t.end}${this.editor.tick!==t.key.tick?' · editing hold':''}`;}catch{return 'No drawing exposure at this frame';}}
  sync(){if(!this.active)return;try{const t=this.editor.drawingTarget();this.exposure={layerId:t.id,start:t.key.tick,end:t.end};this.lastLayer=t.id;}catch{this.exposure=null;}this.viewport.setAttribute('aria-label','Drawing canvas. B brush, E eraser, L select pixels, H pan.');this.overlay.style.cursor=this.tool==='pan'?'grab':this.tool==='transform'?'move':'crosshair';}
  propertyValue(key){key=key.slice(5);if(key==='viewAngle')return (this.state.view.rotation??0)*180/Math.PI;if(key==='selectionScale')return (this.selection?.scale??1)*100;if(key==='selectionAngle')return this.selection?.angle??0;return this.settings[key]*(['opacity','flow','hardness','stabilization'].includes(key)?100:1);}
  propertySet(key,value){key=key.slice(5);if(key==='viewAngle')this.state.view.rotation=value*Math.PI/180;else if(key==='selectionScale'||key==='selectionAngle'){if(this.selection){this.selection[key==='selectionScale'?'scale':'angle']=key==='selectionScale'?value/100:value;this.previewSelection();}}else{this.settings[key]=value/(['opacity','flow','hardness','stabilization'].includes(key)?100:1);if(['size','opacity','flow','hardness'].includes(key))this.settings.preset=null;}this.onRender();}
  async prepareVisible(){if(!this.active||this.gesture)return;let target;try{target=this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const owner=this.owner,revision=this.editor.revision;try{await owner.surface(target.figure);if(owner===this.owner&&revision===this.editor.revision){this.onRender();}}catch(error){if(error.name!=='AbortError')this.onError(error);}}
  get renderPreview(){const g=this.gesture;if(!g?.target?.created)return null;if(!g.preview){const report={...this.editor.report,figure_types:[...this.editor.report.figure_types,g.target.figure],_styk:{...this.editor.report._styk,layers:{...this.editor.report._styk.layers,assignments:{...this.editor.report._styk.layers.assignments,[g.target.object.unique_id]:g.target.id}}}},frame=createFrame([...this.editor.evaluatedFrame.objects.filter(o=>o.unique_id!==g.target.object.unique_id),g.target.object]);Object.assign(frame,{camera:this.editor.evaluatedFrame.camera});for(const key of ['background_id','background_id_b','background_mix','background_color','_stykBackgroundColor'])if(key in this.editor.evaluatedFrame)frame[key]=this.editor.evaluatedFrame[key];g.preview={report,frame,geometry:buildGeometry(report,frame)};}return g.preview;}
  resource(figure){if(!drawingMetadata(figure))return null;const entry=this.owner?.entries.get(drawingMetadata(figure).celId);return entry?.canvas?entry:null;}
  point(event){const rect=this.viewport.getBoundingClientRect();return screenToWorld({x:(event.clientX-rect.left)*this.viewport.clientWidth/rect.width,y:(event.clientY-rect.top)*this.viewport.clientHeight/rect.height},{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false});}
  geometryItem(target){let item;if(target.created)item=buildGeometry({...this.editor.report,figure_types:[...this.editor.report.figure_types,target.figure]},createFrame([target.object])).drawables[0];else item=this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)throw new Error('The drawing pose is unavailable.');return item;}
  pixel(event,target){return inversePoint(drawingMatrix(this.geometryItem(target)),this.point(event));}
  growthBounds(target,event){
    const rect=this.viewport.getBoundingClientRect(),options={empty:target.created,margin:(this.settings.size/2+32)*drawingMetadata(target.figure).pixelsPerUnit,maxPixels:this.owner.decodedBudget/8};
    const corners=[[rect.left,rect.top],[rect.right,rect.top],[rect.right,rect.bottom],[rect.left,rect.bottom]].map(([clientX,clientY])=>this.pixel({clientX,clientY},target));
    try{return drawingExpansion(target.figure,corners,options);}catch{
      // A far zoom-out must not allocate the entire visible world. Grow around
      // the pointer instead; sample() rejects boundary crossings without clipping.
      return drawingExpansion(target.figure,[this.pixel(event,target)],options);
    }
  }
  async expandTarget(target,bounds,owner,current){
    const result=target.created?null:await owner.worker.request('expand',{...bounds,source:owner.payload(owner.entry(target.figure))});
    if(!current())return null;
    const figure=expandedDrawingFigure(target.figure,bounds,this.editor.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1),result?.dataUrl);
    return {target:{...target,figure,object:{...structuredClone(target.object),figure_type_id:figure.figure_type_id},created:true},surface:result?owner.adoptSurface(figure,result.pixels):null};
  }
  async down(event){
    if(this.gesture||this.loading)return;if(event.pointerType==='touch'){if(performance.now()-(this.lastPen??-Infinity)<700)return;this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'pan',start:pointerSample(event),view:{...this.state.view}};return;}if(event.pointerType==='pen')this.lastPen=performance.now();
    this.beforeEdit();this.viewport.focus({preventScroll:true});this.overlay.setPointerCapture(event.pointerId);
    const sequence=++this.sequence,revision=this.editor.revision,owner=this.owner;
    const world=this.point(event),paintArea=this.tool==='brush'?{x:Math.floor(world.x)-128,y:Math.floor(world.y)-128,width:256,height:256}:undefined;
    let target=this.editor.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,paintArea}),surface;
    const pending=this.loading={id:event.pointerId,sequence,released:false,samples:[],event:pointerSample(event)};
    const current=()=>{
      const valid=this.loading===pending&&sequence===this.sequence&&revision===this.editor.revision&&owner===this.owner;
      if(!valid&&this.loading===pending){this.loading=null;if(this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);}
      return valid;
    };
    try{
      const bounds=this.tool==='brush'&&event.button!==5&&!(event.buttons&32)?this.growthBounds(target,pending.event):null;
      if(bounds){
        const expanded=await this.expandTarget(target,bounds,owner,current);if(!expanded)return;
        ({target,surface}=expanded);
      }
      surface??=await owner.surface(target.figure);
      if(!current()){owner.discard(target.figure);return;}
    }catch(error){owner.discard(target.figure);throw error;}
    this.loading=null;
    const point=this.pixel(pending.event,target);surface.pinned=true;
    if(this.tool==='eyedropper'){const x=Math.floor(point.x),y=Math.floor(point.y);if(x>=0&&y>=0&&x<surface.width&&y<surface.height){const i=(y*surface.width+x)*4;this.settings.color='#'+[...surface.pixels.subarray(i,i+3)].map(n=>n.toString(16).padStart(2,'0')).join('');this.onUI();}surface.pinned=false;this.setTool('brush');return;}
    if(this.tool==='fill'){surface.pinned=false;await this.fill(target,surface,point);return;}
    if(this.tool==='transform'){if(target.created){surface.pinned=false;return;}this.editor.select(target.object.unique_id);this.editor.beginTranslationDrag('Move drawing');this.gesture={id:event.pointerId,target,surface,kind:'pose',start:this.point(event)};}
    else if(this.tool==='lasso'){
      if(this.selection&&this.selection.target.figure!==target.figure)this.cancelSelection();
      if(this.selection&&!this.selectionContains(point))this.applySelection();
      if(this.selection){this.gesture={id:event.pointerId,target,surface,kind:'selection-move',start:point,dx:this.selection.dx,dy:this.selection.dy};}
      else this.gesture={id:event.pointerId,target,surface,kind:'lasso',points:[point]};
    }else{
      this.cancelSelection();const color=this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16));
      const brush=new DrawingStroke(surface.pixels,surface.width,surface.height,{...this.settings,color,size:this.settings.size*drawingMetadata(target.figure).pixelsPerUnit,erase:this.tool==='eraser'||event.button===5||Boolean(event.buttons&32),maxBytes:this.editor.historyBytes-65536});
      this.gesture={id:event.pointerId,target,surface,kind:'stroke',brush};this.sample(pending.event);
    }
    for(const sample of pending.samples)this.move({...sample,pointerId:event.pointerId});if(pending.released)this.finish();this.onRender();
  }
  sample(event){const g=this.gesture,p=this.pixel(event,g.target),radius=g.brush.erase?0:this.settings.size*drawingMetadata(g.target.figure).pixelsPerUnit/2;
    if(!g.brush.erase&&(p.x-radius<0||p.y-radius<0||p.x+radius>g.surface.width||p.y+radius>g.surface.height))throw new Error('Zoom in or pan closer before painting this area. The stroke was cancelled to preserve its edges.');
    g.brush.sample({...p,pressure:event.pointerType==='pen'?event.pressure||.05:1,time:event.timeStamp});if(!this.presentFrame)this.presentFrame=requestAnimationFrame(()=>{this.presentFrame=null;if(this.gesture===g){this.owner.present(g.surface,g.brush.dirty);g.brush.dirty=null;}});}
  move(event){this.cursor=pointerSample(event);if(this.loading?.id===event.pointerId){const samples=this.loading.samples;if(samples.length>=256)samples.splice(1,128);samples.push(pointerSample(event));return;}const g=this.gesture;if(!g||g.id!==event.pointerId){this.onRender();return;}
    if(g.kind==='pan'){const rect=this.viewport.getBoundingClientRect();this.state.view.x=g.view.x+(event.clientX-g.start.clientX)*this.viewport.clientWidth/rect.width;this.state.view.y=g.view.y+(event.clientY-g.start.clientY)*this.viewport.clientHeight/rect.height;}
    else if(g.kind==='stroke'){const samples=event.getCoalescedEvents?.();for(const sample of samples?.length?samples:[event])this.sample(sample);}
    else if(g.kind==='pose'){const p=this.point(event);this.editor.moveSelection(p.x-g.start.x,p.y-g.start.y,{fromStart:true});}
    else if(g.kind==='lasso'){const p=this.pixel(event,g.target);if(g.points.length<8192&&Math.hypot(p.x-g.points.at(-1).x,p.y-g.points.at(-1).y)>1)g.points.push(p);}
    else if(g.kind==='selection-move'){const p=this.pixel(event,g.target);this.selection.dx=g.dx+p.x-g.start.x;this.selection.dy=g.dy+p.y-g.start.y;this.previewSelection();}
    this.onRender();
  }
  up(event,cancel=false){if(this.loading?.id===event.pointerId){if(cancel){this.sequence++;this.loading=null;}else this.loading.released=true;return;}if(this.gesture?.id!==event.pointerId)return;cancel?this.cancel():this.finish();}
  finish(){if(this.loading)this.cancel();const g=this.gesture;if(!g)return;if(g.kind==='pan'){this.gesture=null;if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);return;}this.gesture=null;cancelAnimationFrame(this.presentFrame);this.presentFrame=null;try{
    if(g.kind==='stroke'){const tiles=g.brush.finish();try{this.editor.commitDrawingPixels(g.target,tiles,g.brush.erase?'Erase stroke':'Brush stroke');}catch(error){for(const t of tiles)writeTile(g.surface.pixels,g.surface.width,t,t.before);throw error;}}
    else if(g.kind==='pose')this.editor.commitDrag();
    else if(g.kind==='lasso')this.makeSelection(g);
  }finally{g.surface.pinned=Boolean(this.selection?.surface===g.surface);if(this.selection?.surface===g.surface)this.previewSelection();else{this.owner.present(g.surface);this.owner.discard(g.target.figure);}if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.sync();this.onUI();this.onRender();}}
  cancel(){this.sequence++;const pending=this.loading;this.loading=null;if(pending&&this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);cancelAnimationFrame(this.presentFrame);this.presentFrame=null;const g=this.gesture;if(!g){this.fillAbort?.abort();return;}this.gesture=null;if(g.kind==='pan'){Object.assign(this.state.view,g.view);this.onRender();return;}if(g.kind==='stroke')g.brush.cancel();if(g.kind==='pose')this.editor.cancelDrag();if(g.kind==='selection-move')this.cancelSelection();g.surface.pinned=false;this.owner.present(g.surface);this.owner.discard(g.target.figure);this.prepareVisible();if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.onRender();}
  async barrier(options){this.finish();this.applySelection();if(this.loading)throw new Error('Wait for the drawing to finish loading.');if(this.fillAbort)throw new Error('Finish or cancel the fill first.');await drawingBarrier(this.editor.report,options);}
  async fill(target,surface,point){
    const controller=this.fillAbort=new AbortController(),revision=this.editor.revision,owner=this.owner;surface.pinned=true;this.onStatus('Filling drawing… Escape cancels.');
    const worker=new Worker(new URL('./drawing-worker.mjs',import.meta.url),{type:'module',name:'StykAnimate flood fill'});
    try{
      const before=surface.pixels.slice();let source;
      if(this.settings.sampleAll){await this.barrierForComposite();const c=canvas(surface.width,surface.height),ctx=c.getContext('2d'),item=this.geometryItem(target),matrix=drawingMatrix(item),inverse=new DOMMatrix(matrix).inverse();ctx.setTransform(inverse);drawGeometry(ctx,{drawables:this.editor.geometry.drawables.filter(i=>this.editor.getLayer(this.editor.layerForUid(i.obj.unique_id))?.visible!==false)},this.getResources());source=ctx.getImageData(0,0,c.width,c.height).data.buffer;}
      const result=await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Fill cancelled.','AbortError'));controller.signal.addEventListener('abort',abort,{once:true});worker.onerror=e=>reject(new Error(e.message||'Fill worker failed.'));worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data);worker.postMessage({id:1,kind:'fill',tileHistory:true,maxBytes:this.editor.historyBytes-65536,width:surface.width,height:surface.height,pixels:before.buffer,source,options:{...point,color:[...this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16)),Math.round(this.settings.opacity*255)],tolerance:this.settings.tolerance,expansion:this.settings.expansion,gap:this.settings.gap}},[before.buffer,...(source?[source]:[])]);});
      if(controller.signal.aborted||owner!==this.owner||revision!==this.editor.revision)throw new DOMException('Fill superseded by another edit.','AbortError');
      const tiles=result.tiles;this.editor.commitDrawingPixels(target,tiles,'Fill drawing');this.onStatus('Drawing filled.');
    }finally{worker.terminate();surface.pinned=false;if(this.fillAbort===controller)this.fillAbort=null;this.onRender();}
  }
  async barrierForComposite(){await drawingBarrier(this.editor.report);const assets=this.editor.geometry.drawables.filter(i=>i.type==='image');await Promise.all(assets.map(async i=>{const image=this.getResources().image(this.getResources().url(i.asset));if(image&&!image.complete)await image.decode?.();}));}
  makeSelection(g){const mask=lassoMask(g.surface.width,g.surface.height,g.points);if(!mask.some(Boolean))return;this.cancelSelection();const xs=g.points.map(p=>p.x),ys=g.points.map(p=>p.y);this.selection={cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2,target:g.target,surface:g.surface,mask,original:g.surface.pixels.slice(),points:g.points,dx:0,dy:0,scale:1,angle:0};this.selection.surface.pinned=true;this.previewSelection();}
  previewSelection(){const s=this.selection;if(!s)return;const {surface}=s,w=surface.width,h=surface.height;if(!s.cutout){s.cutout=canvas(w,h);const pixels=s.original.slice();for(let p=0;p<s.mask.length;p++)if(!s.mask[p])pixels[p*4+3]=0;s.cutout.getContext('2d').putImageData(new ImageData(pixels,w,h),0,0);s.base=s.original.slice();for(let p=0;p<s.mask.length;p++)if(s.mask[p])s.base[p*4+3]=0;}
    const ctx=surface.context;ctx.putImageData(new ImageData(s.base,w,h),0,0);ctx.save();ctx.translate(s.cx+s.dx,s.cy+s.dy);ctx.rotate(s.angle*Math.PI/180);ctx.scale(s.scale,s.scale);ctx.drawImage(s.cutout,-s.cx,-s.cy);ctx.restore();surface.stamp++;surface.dirtyRect={x:0,y:0,right:w,bottom:h};this.onRender();
  }
  selectionContains(point){const s=this.selection;if(!s)return false;const angle=-s.angle*Math.PI/180,x=point.x-s.cx-s.dx,y=point.y-s.cy-s.dy,px=Math.floor(s.cx+(Math.cos(angle)*x-Math.sin(angle)*y)/s.scale),py=Math.floor(s.cy+(Math.sin(angle)*x+Math.cos(angle)*y)/s.scale);return px>=0&&py>=0&&px<s.surface.width&&py<s.surface.height&&Boolean(s.mask[py*s.surface.width+px]);}
  applySelection(){const s=this.selection;if(!s)return;if(!s.dx&&!s.dy&&s.scale===1&&!s.angle){this.cancelSelection();return;}try{const after=s.surface.context.getImageData(0,0,s.surface.width,s.surface.height).data,tiles=pixelChanges(s.original,after,s.surface.width,s.surface.height,this.editor.historyBytes-65536);this.editor.commitDrawingPixels(s.target,tiles,'Transform selected pixels');}finally{this.cancelSelection();this.onRender();}}
  cancelSelection(){const s=this.selection;if(!s)return;this.selection=null;this.owner.present(s.surface);s.surface.pinned=false;if(s.cutout)s.cutout.width=s.cutout.height=1;}
  async action(action){this.finish();const e=this.editor,ids=[e.activeLayerId];
    if(action==='new'){const layer=e.createDrawingLayer();this.state.selectedTrackId=layer.id;this.getTimeline()?.selectTrack?.(layer.id);this.sync();this.onUI();return;}
    if(!['copy-pixels','cut-pixels','apply-selection','cancel-selection'].includes(action))this.applySelection();
    if(action==='blank')return e.drawingKey(ids,e.tick,{blank:true});if(action==='copy-key'){if(!e.drawingKey(ids))this.onStatus('This cell already starts a drawing. Use Next copy to add time.');return;}
    if(action==='extend')return e.extendDrawing(ids,this.settings.length);if(action==='next-blank'||action==='next-copy')return e.nextDrawing(ids,{blank:action==='next-blank',length:this.settings.length});
    if(action==='apply-selection')return this.applySelection();if(action==='cancel-selection')return this.cancelSelection();if(action==='retry')return this.barrier();
    if(action==='duplicate-layer'){await this.barrier();const source=e.getLayer(e.activeLayerId),end=e.report._styk.layerSheet.tracks[source.id].end;const old=e._sheetClipboard;try{e.sheetCopyFrames([source.id],0,end-1);return e.movieclipBatch('Duplicate drawing layer',()=>{const layer=e.createLayer(source.name+' copy',{drawing:true});e.sheetPasteFrames([layer.id],0);});}finally{e._sheetClipboard=old;}}
    if(['copy-pixels','cut-pixels'].includes(action))return this.getClipboard().copy('drawing-pixels',async()=>{
      const s=this.selection;if(!s)throw new Error('Select pixels with the lasso first.');
      const revision=e.revision;let pixels;
      if(!s.dx&&!s.dy&&!s.angle&&s.scale===1){pixels=s.original.slice();for(let p=0;p<s.mask.length;p++)if(!s.mask[p])pixels.fill(0,p*4,p*4+4);}
      else{const copy=canvas(s.surface.width,s.surface.height),ctx=copy.getContext('2d');ctx.translate(s.cx+s.dx,s.cy+s.dy);ctx.rotate(s.angle*Math.PI/180);ctx.scale(s.scale,s.scale);ctx.drawImage(s.cutout,-s.cx,-s.cy);pixels=ctx.getImageData(0,0,copy.width,copy.height).data;copy.width=copy.height=1;}
      const {dataUrl}=await this.owner.worker.request('encode',{width:s.surface.width,height:s.surface.height,tiles:[{x:0,y:0,width:s.surface.width,height:s.surface.height,pixels}]});
      if(e.revision!==revision||this.selection!==s)throw new DOMException('The selection changed. Copy it again.','AbortError');
      const metadata=drawingMetadata(s.target.figure);
      e._drawingPixelClipboard={width:s.surface.width,height:s.surface.height,dataUrl,pixelsPerUnit:metadata.pixelsPerUnit,origin:{...metadata.origin}};
      if(action==='cut-pixels'){try{const tiles=pixelChanges(s.original,s.base,s.surface.width,s.surface.height,e.historyBytes-65536);e.commitDrawingPixels(s.target,tiles,'Cut selected pixels');}finally{this.cancelSelection();}}return true;
    });
    if(action==='paste-pixels')return this.getClipboard().paste('drawing-pixels',async()=>{
      const clip=e._drawingPixelClipboard;if(!clip)throw new Error('Copy selected pixels first.');this.cancelSelection();
      const revision=e.revision,owner=this.owner,current=()=>revision===e.revision&&owner===this.owner;
      let target=e.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,paintArea:clip.origin?{...clip.origin,width:256,height:256}:undefined}),surface;
      try{
        const d=drawingMetadata(target.figure),ratio=d.pixelsPerUnit/clip.pixelsPerUnit,origin=clip.origin??d.origin;
        let x=(origin.x-d.origin.x)*d.pixelsPerUnit,y=(origin.y-d.origin.y)*d.pixelsPerUnit;
        const bounds=drawingExpansion(target.figure,[{x,y},{x:x+clip.width*ratio,y:y+clip.height*ratio}],{empty:target.created,margin:0,maxPixels:owner.decodedBudget/8});
        if(bounds){const expanded=await this.expandTarget(target,bounds,owner,current);if(!expanded)return;({target,surface}=expanded);x+=bounds.offsetX;y+=bounds.offsetY;}
        surface??=await owner.surface(target.figure);surface.pinned=true;
        const result=await owner.worker.request('paste',{...owner.payload(surface),clip:{width:clip.width,height:clip.height,base:clip.dataUrl},x,y,ratio,maxBytes:e.historyBytes-65536});
        if(!current())throw new DOMException('The drawing changed before paste.','AbortError');
        return e.commitDrawingPixels(target,result.tiles,'Paste selected pixels');
      }finally{if(surface){surface.pinned=false;owner.present(surface);}owner.discard(target.figure);}
    });
    if(action==='resample'){
      this.applySelection();const target=e.drawingTarget();if(!target.figure)throw new Error('Paint a drawing before resampling it.');
      const d=drawingMetadata(target.figure),ratio=this.settings.resolution/d.pixelsPerUnit;if(ratio===1){this.onStatus('This drawing already uses the chosen resolution.');return;}
      await this.barrier();const revision=e.revision,width=d.width*ratio,height=d.height*ratio;
      const result=await this.owner.worker.request('resample',{width,height,base:target.figure.image_assets[0].data_url});
      if(revision!==e.revision)throw new DOMException('The drawing changed during resampling.','AbortError');
      e.resampleDrawing(target,{width,height,pixelsPerUnit:this.settings.resolution,dataUrl:result.dataUrl});this.onStatus('Drawing resampled. Undo restores its original pixels.');
    }
  }

  change(event){this.finish();const input=event.target,name=input.dataset.drawSetting;if(!name)return;this.settings[name]=input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value);this.sync();this.onUI();}
  overlayDraw(ctx){if(!this.active)return;let target;try{target=this.gesture?.target??this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const g=this.gesture,item=this.renderPreview?.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id)??this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)return;const matrix=drawingMatrix(item),screen=p=>worldToScreen(transformPoint(matrix,p),{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false}),d=drawingMetadata(target.figure);ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;const points=g?.kind==='lasso'?g.points:this.selection?.points;if(points?.length){ctx.strokeStyle='#2878ed';ctx.beginPath();points.forEach((p,i)=>{const s=this.selection,angle=(s?.angle??0)*Math.PI/180,x=s?(p.x-s.cx)*s.scale:p.x,y=s?(p.y-s.cy)*s.scale:p.y,q=screen(s?{x:s.cx+s.dx+Math.cos(angle)*x-Math.sin(angle)*y,y:s.cy+s.dy+Math.sin(angle)*x+Math.cos(angle)*y}:p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();}if(this.cursor&&['brush','eraser'].includes(this.tool)){const p=this.pixel(this.cursor,target),center=screen(p),edge=screen({x:p.x+this.settings.size*d.pixelsPerUnit/2,y:p.y}),radius=Math.hypot(edge.x-center.x,edge.y-center.y);ctx.setLineDash([]);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(center.x,center.y,Math.max(1,radius),0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.stroke();}ctx.restore();}
  destroy(){this.cancel();this.cancelSelection();this.events.abort();this.owner.dispose();}
}
