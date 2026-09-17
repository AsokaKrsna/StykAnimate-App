import {BRUSH_PRESETS} from './drawing-view.mjs';
import {DrawingStroke,tileChanges,applyTileChanges,lassoMask,tileAlignedRect} from './drawing-pixels.mjs';
import {drawingMetadata,migrateDrawingFigure,isDrawingLayer,drawingPixelMatrix,inversePoint,transformPoint,DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {TILE,tileKey,TileStore} from './drawing-tiles.mjs';
import {encodeDrawingPNG} from './drawing-png.mjs';
import {drawingBarrier} from './drawing-resources.mjs';
import {buildGeometry,drawGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {screenToWorld,worldToScreen} from './renderer-geometry.mjs';

const pointerSample=e=>({clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,pointerType:e.pointerType,timeStamp:e.timeStamp,button:e.button,buttons:e.buttons});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const brushKeys=['preset','size','opacity','flow','hardness','pressureSize','pressureOpacity','sizeCurve','opacityCurve','stabilization'];
const unionRects=(a,b)=>{if(!a)return b?{...b}:null;if(!b)return{...a};const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};};
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
  get renderPreview(){const g=this.gesture;if(!g?.target?.created&&!g?.target?.migratedFrom)return null;if(!g.preview){const report={...this.editor.report,figure_types:[...this.editor.report.figure_types,g.target.figure],_styk:{...this.editor.report._styk,layers:{...this.editor.report._styk.layers,assignments:{...this.editor.report._styk.layers.assignments,[g.target.object.unique_id]:g.target.id}}}},frame=createFrame([...this.editor.evaluatedFrame.objects.filter(o=>o.unique_id!==g.target.object.unique_id),g.target.object]);Object.assign(frame,{camera:this.editor.evaluatedFrame.camera});for(const key of ['background_id','background_id_b','background_mix','background_color','_stykBackgroundColor'])if(key in this.editor.evaluatedFrame)frame[key]=this.editor.evaluatedFrame[key];g.preview={report,frame,geometry:buildGeometry(report,frame)};}return g.preview;}
  resource(figure){if(!drawingMetadata(figure))return null;const entry=this.owner?.presenter(figure);return entry?.store?entry:null;}
  point(event){const rect=this.viewport.getBoundingClientRect();return screenToWorld({x:(event.clientX-rect.left)*this.viewport.clientWidth/rect.width,y:(event.clientY-rect.top)*this.viewport.clientHeight/rect.height},{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false});}
  geometryItem(target){let item;if(target.created||target.migratedFrom)item=buildGeometry({...this.editor.report,figure_types:[...this.editor.report.figure_types,target.figure]},createFrame([target.object])).drawables[0];else item=this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)throw new Error('The drawing pose is unavailable.');return item;}
  pixelMatrix(target){return drawingPixelMatrix(this.geometryItem(target));}
  pixel(event,target){return inversePoint(this.pixelMatrix(target),this.point(event));}
  async down(event){
    if(this.gesture||this.loading)return;if(event.pointerType==='touch'){if(performance.now()-(this.lastPen??-Infinity)<700)return;this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'pan',start:pointerSample(event),view:{...this.state.view}};return;}if(event.pointerType==='pen')this.lastPen=performance.now();
    this.beforeEdit();this.viewport.focus({preventScroll:true});this.overlay.setPointerCapture(event.pointerId);
    const sequence=++this.sequence,revision=this.editor.revision,owner=this.owner;
    let target=this.editor.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,world:this.point(event)}),surface;
    const pending=this.loading={id:event.pointerId,sequence,released:false,samples:[],event:pointerSample(event)};
    const current=()=>{
      const valid=this.loading===pending&&sequence===this.sequence&&revision===this.editor.revision&&owner===this.owner;
      if(!valid&&this.loading===pending){this.loading=null;if(this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);}
      return valid;
    };
    try{
      surface=await owner.surface(target.figure);
      if(!current()){owner.discard(target.figure);return;}
      // v1 cels migrate lazily on the first pixel edit; posing keeps them v1.
      const d=drawingMetadata(target.figure);
      if(d?.version===1&&['brush','eraser','fill','lasso'].includes(this.tool)){
        const figure=migrateDrawingFigure(target.figure,this.editor.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1),{bounds:surface.store.bounds});
        owner.retarget(d.celId,figure);
        target={...target,figure,object:{...structuredClone(target.object),figure_type_id:figure.figure_type_id},migratedFrom:d.celId};
      }
    }catch(error){owner.discard(target.figure);throw error;}
    this.loading=null;
    const point=this.pixel(pending.event,target);surface.pinned=true;
    if(this.tool==='fill'){surface.pinned=false;await this.fill(target,surface,point);return;}
    if(this.tool==='transform'){if(target.created){surface.pinned=false;return;}this.editor.select(target.object.unique_id);this.editor.beginTranslationDrag('Move drawing');this.gesture={id:event.pointerId,target,surface,kind:'pose',start:this.point(event)};}
    else if(this.tool==='lasso'){
      if(this.selection&&this.selection.target.figure!==target.figure)this.cancelSelection();
      if(this.selection&&!this.selectionContains(point))this.applySelection();
      if(this.selection){this.gesture={id:event.pointerId,target,surface,kind:'selection-move',start:point,dx:this.selection.dx,dy:this.selection.dy};}
      else this.gesture={id:event.pointerId,target,surface,kind:'lasso',points:[point]};
    }else{
      this.cancelSelection();const color=this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16));
      const brush=new DrawingStroke(surface.store,{...this.settings,color,size:this.settings.size*drawingMetadata(target.figure).pixelsPerUnit,erase:this.tool==='eraser'||event.button===5||Boolean(event.buttons&32),maxBytes:this.editor.historyBytes-65536});
      this.gesture={id:event.pointerId,target,surface,kind:'stroke',brush};this.sample(pending.event);
    }
    for(const sample of pending.samples)this.move({...sample,pointerId:event.pointerId});if(pending.released)this.finish();this.onRender();
  }
  sample(event){const g=this.gesture,p=this.pixel(event,g.target);
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
    if(g.kind==='stroke'){const tiles=g.brush.finish();try{this.editor.commitDrawingPixels(g.target,tiles,g.brush.erase?'Erase stroke':'Brush stroke');}catch(error){applyTileChanges(g.surface.store,tiles,'before');throw error;}}
    else if(g.kind==='pose')this.editor.commitDrag();
    else if(g.kind==='lasso')this.makeSelection(g);
  }finally{g.surface.pinned=Boolean(this.selection?.surface===g.surface);if(this.selection?.surface===g.surface)this.previewSelection();else{this.owner.present(g.surface);this.owner.discard(g.target.figure);}if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.sync();this.onUI();this.onRender();}}
  cancel(){this.sequence++;const pending=this.loading;this.loading=null;if(pending&&this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);cancelAnimationFrame(this.presentFrame);this.presentFrame=null;const g=this.gesture;if(!g){this.fillAbort?.abort();return;}this.gesture=null;if(g.kind==='pan'){Object.assign(this.state.view,g.view);this.onRender();return;}if(g.kind==='stroke')g.brush.cancel();if(g.kind==='pose')this.editor.cancelDrag();if(g.kind==='selection-move')this.cancelSelection();g.surface.pinned=false;this.owner.present(g.surface);this.owner.discard(g.target.figure);this.prepareVisible();if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.onRender();}
  async barrier(options){this.finish();this.applySelection();if(this.loading)throw new Error('Wait for the drawing to finish loading.');if(this.fillAbort)throw new Error('Finish or cancel the fill first.');await drawingBarrier(this.editor.report,options);}
  /** Fill bounds = stage ∪ artwork ∪ viewport, in the cel's pixel space. */
  fillBounds(target,store){
    const matrix=this.pixelMatrix(target),toPixel=p=>inversePoint(matrix,p);
    const report=this.editor.report,stage=[[0,0],[report.canvas_width,0],[report.canvas_width,report.canvas_height],[0,report.canvas_height]].map(([x,y])=>toPixel({x,y}));
    const rect=this.viewport.getBoundingClientRect(),view=[[rect.left,rect.top],[rect.right,rect.top],[rect.right,rect.bottom],[rect.left,rect.bottom]].map(([clientX,clientY])=>toPixel(this.point({clientX,clientY})));
    const box=points=>({x:Math.floor(Math.min(...points.map(p=>p.x))),y:Math.floor(Math.min(...points.map(p=>p.y))),width:Math.ceil(Math.max(...points.map(p=>p.x)))-Math.floor(Math.min(...points.map(p=>p.x))),height:Math.ceil(Math.max(...points.map(p=>p.y)))-Math.floor(Math.min(...points.map(p=>p.y)))});
    return unionRects(unionRects(box(stage),box(view)),store.bounds);
  }
  async fill(target,surface,point){
    const controller=this.fillAbort=new AbortController(),revision=this.editor.revision,owner=this.owner;surface.pinned=true;this.onStatus('Filling drawing… Escape cancels.');
    try{
      const bounds=this.fillBounds(target,surface.store);
      if(!bounds)return;if(bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('Zoom in before filling: the fill area exceeds 16 megapixels.');
      let source;
      if(this.settings.sampleAll){await this.barrierForComposite();const c=canvas(bounds.width,bounds.height),ctx=c.getContext('2d'),inverse=new DOMMatrix(this.pixelMatrix(target)).inverse();ctx.setTransform(inverse.a,inverse.b,inverse.c,inverse.d,inverse.e-bounds.x,inverse.f-bounds.y);drawGeometry(ctx,{drawables:this.editor.geometry.drawables.filter(i=>this.editor.getLayer(this.editor.layerForUid(i.obj.unique_id))?.visible!==false)},this.getResources());source=ctx.getImageData(0,0,c.width,c.height).data.buffer;}
      const tiles=[...TileStore.tilesInRect(bounds.x,bounds.y,bounds.width,bounds.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
      const result=await owner.worker.request('fill',{bounds,tiles,options:{...point,color:[...this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16)),Math.round(this.settings.opacity*255)],tolerance:this.settings.tolerance,expansion:this.settings.expansion,gap:this.settings.gap},source,maxBytes:this.editor.historyBytes-65536},{transfer:[...tiles.map(t=>t.pixels),...(source?[source]:[])]});
      if(controller.signal.aborted||owner!==this.owner||revision!==this.editor.revision)throw new DOMException('Fill superseded by another edit.','AbortError');
      this.editor.commitDrawingPixels(target,result.tiles,'Fill drawing');this.onStatus('Drawing filled.');
    }finally{surface.pinned=false;if(this.fillAbort===controller)this.fillAbort=null;this.onRender();}
  }
  async barrierForComposite(){await drawingBarrier(this.editor.report);const assets=this.editor.geometry.drawables.filter(i=>i.type==='image');await Promise.all(assets.map(async i=>{const image=this.getResources().image(this.getResources().url(i.asset));if(image&&!image.complete)await image.decode?.();}));}
  makeSelection(g){
    const mask=lassoMask(g.points);if(!mask.mask.some(Boolean))return;this.cancelSelection();
    const store=g.surface.store,xs=g.points.map(p=>p.x),ys=g.points.map(p=>p.y);
    const s=this.selection={cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2,target:g.target,surface:g.surface,mask,original:new Map(),touched:new Set(),points:g.points,dx:0,dy:0,scale:1,angle:0};
    // Snapshot the mask region content once: cutout keeps masked pixels, base
    // keeps the rest. The store snapshot only covers tiles the preview touches.
    const region=store.readRect(mask.x,mask.y,mask.width,mask.height),cut=new Uint8ClampedArray(region),base=new Uint8ClampedArray(region);
    for(let p=0;p<mask.width*mask.height;p++){if(mask.mask[p])base[p*4+3]=0;else cut[p*4+3]=0;}
    s.cutout=canvas(mask.width,mask.height);s.cutout.getContext('2d').putImageData(new ImageData(cut,mask.width,mask.height),0,0);
    // `region` keeps the exact pre-preview bytes: the canvas composite preview
    // degrades RGB under partial alpha, so copy/cut must not read it back.
    s.basePixels=base;s.originalPixels=region;g.surface.pinned=true;this.previewSelection();
  }
  previewSelection(){
    const s=this.selection;if(!s)return;const store=s.surface.store,B=s.mask;
    const angle=s.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),sc=s.scale;
    const t=p=>({x:s.cx+s.dx+cos*(p.x-s.cx)*sc-sin*(p.y-s.cy)*sc,y:s.cy+s.dy+sin*(p.x-s.cx)*sc+cos*(p.y-s.cy)*sc});
    const corners=[[B.x,B.y],[B.x+B.width,B.y],[B.x,B.y+B.height],[B.x+B.width,B.y+B.height]].map(([x,y])=>t({x,y}));
    const dx0=Math.min(B.x,...corners.map(p=>p.x)),dy0=Math.min(B.y,...corners.map(p=>p.y));
    const R=tileAlignedRect(dx0,dy0,Math.max(B.x+B.width,...corners.map(p=>p.x))-dx0,Math.max(B.y+B.height,...corners.map(p=>p.y))-dy0);
    for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?store.set(tx,ty,o):store.delete(tx,ty);}
    s.touched.clear();
    for(const [tx,ty] of TileStore.tilesInRect(R.x,R.y,R.width,R.height)){const key=tileKey(tx,ty);if(!s.original.has(key))s.original.set(key,store.get(tx,ty)?.pixels.slice()??null);s.touched.add(key);}
    if(!s.preview||s.preview.width!==R.width||s.preview.height!==R.height)s.preview=canvas(R.width,R.height);
    const ctx=s.preview.getContext('2d'),tile=canvas(TILE,TILE),tctx=tile.getContext('2d');
    ctx.clearRect(0,0,R.width,R.height);
    for(const [tx,ty] of TileStore.tilesInRect(R.x,R.y,R.width,R.height)){const current=store.get(tx,ty);if(!current)continue;tctx.putImageData(new ImageData(current.pixels,TILE,TILE),0,0);ctx.drawImage(tile,tx*TILE-R.x,ty*TILE-R.y);}
    ctx.putImageData(new ImageData(s.basePixels,B.width,B.height),B.x-R.x,B.y-R.y);
    ctx.save();ctx.translate(s.cx+s.dx-R.x,s.cy+s.dy-R.y);ctx.rotate(angle);ctx.scale(sc,sc);ctx.drawImage(s.cutout,B.x-s.cx,B.y-s.cy);ctx.restore();
    store.writeRect(R.x,R.y,R.width,R.height,ctx.getImageData(0,0,R.width,R.height).data);
    this.owner.present(s.surface,R);this.onRender();
  }
  selectionContains(point){const s=this.selection;if(!s)return false;const B=s.mask,angle=-s.angle*Math.PI/180,x=point.x-s.cx-s.dx,y=point.y-s.cy-s.dy,px=Math.floor(s.cx+(Math.cos(angle)*x-Math.sin(angle)*y)/s.scale),py=Math.floor(s.cy+(Math.sin(angle)*x+Math.cos(angle)*y)/s.scale);return px>=B.x&&py>=B.y&&px<B.x+B.width&&py<B.y+B.height&&Boolean(B.mask[(py-B.y)*B.width+(px-B.x)]);}
  applySelection(){const s=this.selection;if(!s)return;if(!s.dx&&!s.dy&&s.scale===1&&!s.angle){this.cancelSelection();return;}try{const tiles=tileChanges(s.surface.store,s.original,this.editor.historyBytes-65536);this.editor.commitDrawingPixels(s.target,tiles,'Transform selected pixels');}finally{this.endSelection(false);this.onRender();}}
  endSelection(restore=true){const s=this.selection;if(!s)return;this.selection=null;const store=s.surface.store;
    if(restore)for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?store.set(tx,ty,o):store.delete(tx,ty);}
    this.owner.present(s.surface);s.surface.pinned=false;if(s.cutout)s.cutout.width=s.cutout.height=1;if(s.preview)s.preview.width=s.preview.height=1;}
  cancelSelection(){this.endSelection(true);}
  async action(action){this.finish();const e=this.editor,ids=[e.activeLayerId];
    if(action==='new'){const layer=e.createDrawingLayer();this.state.selectedTrackId=layer.id;this.getTimeline()?.selectTrack?.(layer.id);this.sync();this.onUI();return;}
    if(!['copy-pixels','cut-pixels','apply-selection','cancel-selection'].includes(action))this.applySelection();
    if(action==='blank')return e.drawingKey(ids,e.tick,{blank:true});if(action==='copy-key'){if(!e.drawingKey(ids))this.onStatus('This cell already starts a drawing. Use Next copy to add time.');return;}
    if(action==='extend')return e.extendDrawing(ids,this.settings.length);if(action==='next-blank'||action==='next-copy')return e.nextDrawing(ids,{blank:action==='next-blank',length:this.settings.length});
    if(action==='apply-selection')return this.applySelection();if(action==='cancel-selection')return this.cancelSelection();if(action==='retry')return this.barrier();
    if(action==='duplicate-layer'){await this.barrier();const source=e.getLayer(e.activeLayerId),end=e.report._styk.layerSheet.tracks[source.id].end;const old=e._sheetClipboard;try{e.sheetCopyFrames([source.id],0,end-1);return e.movieclipBatch('Duplicate drawing layer',()=>{const layer=e.createLayer(source.name+' copy',{drawing:true});e.sheetPasteFrames([layer.id],0);});}finally{e._sheetClipboard=old;}}
    if(['copy-pixels','cut-pixels'].includes(action))return this.getClipboard().copy('drawing-pixels',async()=>{
      const s=this.selection;if(!s)throw new Error('Select pixels with the lasso first.');
      const revision=e.revision,B=s.mask;let rect,pixels;
      if(!s.dx&&!s.dy&&!s.angle&&s.scale===1){rect={x:B.x,y:B.y,width:B.width,height:B.height};pixels=new Uint8ClampedArray(s.originalPixels);for(let p=0;p<B.mask.length;p++)if(!B.mask[p])pixels.fill(0,p*4,p*4+4);}
      else{const angle=s.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),sc=s.scale;
        const t=p=>({x:s.cx+s.dx+cos*(p.x-s.cx)*sc-sin*(p.y-s.cy)*sc,y:s.cy+s.dy+sin*(p.x-s.cx)*sc+cos*(p.y-s.cy)*sc});
        const corners=[[B.x,B.y],[B.x+B.width,B.y],[B.x,B.y+B.height],[B.x+B.width,B.y+B.height]].map(([x,y])=>t({x,y}));
        const dx0=Math.floor(Math.min(...corners.map(p=>p.x))),dy0=Math.floor(Math.min(...corners.map(p=>p.y)));
        rect={x:dx0,y:dy0,width:Math.ceil(Math.max(...corners.map(p=>p.x)))-dx0,height:Math.ceil(Math.max(...corners.map(p=>p.y)))-dy0};
        const copy=canvas(rect.width,rect.height),ctx=copy.getContext('2d');ctx.translate(s.cx+s.dx-dx0,s.cy+s.dy-dy0);ctx.rotate(angle);ctx.scale(sc,sc);ctx.drawImage(s.cutout,B.x-s.cx,B.y-s.cy);pixels=ctx.getImageData(0,0,rect.width,rect.height).data;copy.width=copy.height=1;}
      const dataUrl=await encodeDrawingPNG(pixels,rect.width,rect.height);
      if(e.revision!==revision||this.selection!==s)throw new DOMException('The selection changed. Copy it again.','AbortError');
      const metadata=drawingMetadata(s.target.figure),world=transformPoint(this.pixelMatrix(s.target),{x:rect.x,y:rect.y});
      e._drawingPixelClipboard={pixelsPerUnit:metadata.pixelsPerUnit,x:rect.x,y:rect.y,width:rect.width,height:rect.height,dataUrl,world};
      if(action==='cut-pixels'){try{for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?s.surface.store.set(tx,ty,o):s.surface.store.delete(tx,ty);}s.surface.store.writeRect(B.x,B.y,B.width,B.height,s.basePixels);const tiles=tileChanges(s.surface.store,s.original,e.historyBytes-65536);e.commitDrawingPixels(s.target,tiles,'Cut selected pixels');}finally{this.endSelection(false);}}return true;
    });
    if(action==='paste-pixels')return this.getClipboard().paste('drawing-pixels',async()=>{
      const clip=e._drawingPixelClipboard;if(!clip)throw new Error('Copy selected pixels first.');this.cancelSelection();
      const revision=e.revision,owner=this.owner,current=()=>revision===e.revision&&owner===this.owner;
      let target=e.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,world:clip.world}),surface;
      try{
        surface=await owner.surface(target.figure);
        if(!current())return;
        const d=drawingMetadata(target.figure);
        if(d.version===1){const figure=migrateDrawingFigure(target.figure,this.editor.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1),{bounds:surface.store.bounds});owner.retarget(d.celId,figure);target={...target,figure,object:{...structuredClone(target.object),figure_type_id:figure.figure_type_id},migratedFrom:d.celId};}
        surface.pinned=true;
        const matrix=this.pixelMatrix(target),p=inversePoint(matrix,clip.world),ratio=drawingMetadata(target.figure).pixelsPerUnit/clip.pixelsPerUnit;
        // matrix maps target pixels to world; its scale is world units per
        // pixel (object scale / ppu), so the clip-pixel to target-pixel factor
        // is ratio divided by the object's extra scale.
        const scale=Math.hypot(matrix[0],matrix[1]),det=matrix[0]*matrix[3]-matrix[1]*matrix[2],factor=scale>1e-9?ratio/(scale*drawingMetadata(target.figure).pixelsPerUnit):ratio;
        const exact=Math.abs(factor-1)<1e-6&&Math.abs(matrix[1])<1e-9&&Math.abs(matrix[2])<1e-9&&det>0;
        const x=exact?Math.round(p.x):p.x,y=exact?Math.round(p.y):p.y,rr=exact?1:factor;
        const bounds=tileAlignedRect(Math.floor(x),Math.floor(y),Math.max(1,Math.ceil(x+clip.width*rr)-Math.floor(x)),Math.max(1,Math.ceil(y+clip.height*rr)-Math.floor(y)));
        if(bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('This paste exceeds the pixel limit. Use a smaller selection.');
        const tiles=[...TileStore.tilesInRect(bounds.x,bounds.y,bounds.width,bounds.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
        const result=await owner.worker.request('paste',{bounds,tiles,clip:{width:clip.width,height:clip.height,dataUrl:clip.dataUrl},x,y,ratio:rr,maxBytes:e.historyBytes-65536},{transfer:tiles.map(t=>t.pixels)});
        if(!current())throw new DOMException('The drawing changed before paste.','AbortError');
        return e.commitDrawingPixels(target,result.tiles,'Paste selected pixels');
      }finally{if(surface){surface.pinned=false;owner.present(surface);}owner.discard(target.figure);}
    });
    if(action==='resample'){
      this.applySelection();const target=e.drawingTarget();if(!target.figure)throw new Error('Paint a drawing before resampling it.');
      const d=drawingMetadata(target.figure),ratio=this.settings.resolution/d.pixelsPerUnit;if(ratio===1){this.onStatus('This drawing already uses the chosen resolution.');return;}
      await this.barrier();const revision=e.revision,surface=await this.owner.surface(target.figure);
      const bounds=surface.store.bounds;let tiles=[],outBounds=null;
      if(bounds){
        const payload=[...TileStore.tilesInRect(bounds.x,bounds.y,bounds.width,bounds.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
        const result=await this.owner.worker.request('resample',{bounds,tiles:payload,ratio},{transfer:payload.map(t=>t.pixels)});
        if(revision!==e.revision)throw new DOMException('The drawing changed during resampling.','AbortError');
        tiles=result.tiles;outBounds=result.bounds;
      }
      e.resampleDrawing(target,{pixelsPerUnit:this.settings.resolution,tiles,bounds:outBounds});this.onStatus('Drawing resampled. Undo restores its original pixels.');
    }
  }

  change(event){this.finish();const input=event.target,name=input.dataset.drawSetting;if(!name)return;this.settings[name]=input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value);this.sync();this.onUI();}
  overlayDraw(ctx){if(!this.active)return;let target;try{target=this.gesture?.target??this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const g=this.gesture,item=this.renderPreview?.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id)??this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)return;const matrix=drawingPixelMatrix(item),screen=p=>worldToScreen(transformPoint(matrix,p),{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false}),d=drawingMetadata(target.figure);ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;const points=g?.kind==='lasso'?g.points:this.selection?.points;if(points?.length){ctx.strokeStyle='#2878ed';ctx.beginPath();points.forEach((p,i)=>{const s=this.selection,angle=(s?.angle??0)*Math.PI/180,x=s?(p.x-s.cx)*s.scale:p.x,y=s?(p.y-s.cy)*s.scale:p.y,q=screen(s?{x:s.cx+s.dx+Math.cos(angle)*x-Math.sin(angle)*y,y:s.cy+s.dy+Math.sin(angle)*x+Math.cos(angle)*y}:p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();}if(this.cursor&&['brush','eraser'].includes(this.tool)){const p=this.pixel(this.cursor,target),center=screen(p),edge=screen({x:p.x+this.settings.size*d.pixelsPerUnit/2,y:p.y}),radius=Math.hypot(edge.x-center.x,edge.y-center.y);ctx.setLineDash([]);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(center.x,center.y,Math.max(1,radius),0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.stroke();}ctx.restore();}
  destroy(){this.cancel();this.cancelSelection();this.events.abort();this.owner.dispose();}
}
