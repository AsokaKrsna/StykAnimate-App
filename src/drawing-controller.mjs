import {BRUSH_PRESETS} from './drawing-view.mjs';
import {tileChanges,lassoMask,tileAlignedRect,DrawingStroke,StrokePath,normalizeBrush,dabExtent,rectPoints,ellipsePoints,combineMasks,invertMask,rectMask,maskEdges} from './drawing-pixels.mjs';
import {drawingMetadata,migrateDrawingFigure,isDrawingLayer,drawingPixelMatrix,inversePoint,transformPoint,DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {TILE,tileKey,parseTileKey,TileStore} from './drawing-tiles.mjs';
import {encodeDrawingPNG} from './drawing-png.mjs';
import {drawingBarrier,drawingResourcesFor} from './drawing-resources.mjs';
import {drawingCelPrefetch} from './onion-skin.mjs';
import {buildGeometry,drawGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {screenToWorld,worldToScreen} from './renderer-geometry.mjs';

const pointerSample=e=>({clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,pointerType:e.pointerType,timeStamp:e.timeStamp,button:e.button,buttons:e.buttons});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const brushKeys=['preset','size','opacity','flow','hardness','pressureSize','pressureOpacity','pressureFlow','sizeCurve','opacityCurve','stabilization','spacingRatio','texture','roundness','angle','angleMode','scatter','blend','alphaLock'];
// Settings edited as percentages in the inspector.
const PERCENT_SETTINGS=['opacity','flow','hardness','stabilization','roundness','scatter','spacingRatio','texture'];
const hexColor=rgb=>'#'+rgb.slice(0,3).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
const SELECTION_ACTIONS=['copy-pixels','cut-pixels','delete-pixels','apply-selection','cancel-selection','select-all','invert-selection','deselect','fill-selection'];
const unionRects=(a,b)=>{if(!a)return b?{...b}:null;if(!b)return{...a};const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};};
export class DrawingController {
  constructor({editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard,sampleColor}) {
    Object.assign(this,{editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard,sampleColor,settings:{preset:'ink',size:8,color:'#252525',opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,pressureFlow:false,sizeCurve:1,opacityCurve:1,stabilization:0,spacingRatio:.08,texture:0,roundness:1,angle:0,angleMode:'fixed',scatter:0,blend:'normal',alphaLock:false,mirrorX:false,mirrorY:false,selectShape:'lasso',resolution:2,length:1,tolerance:16,expansion:1,gap:0,sampleAll:false},sequence:0,strokeId:0,sessions:new Map(),strokeStats:{batches:0,maxQueueDepth:0,lastRoundTripMs:0}});
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
    // The brush ring tracks the last move; it must not linger once the pointer leaves.
    overlay.addEventListener('pointerleave',()=>{if(this.cursor){this.cursor=null;this.onRender();}},opts);
    editor.addEventListener('change',event=>{
      const kind=event.detail.kind;
      if(kind==='document'){this.cancel();this.selection=null;this.marquee=null;this.bind();}
      if(['seek','history'].includes(kind)){this.cancel();this.cancelSelection();}
      if(kind==='document'||kind==='seek')this.prefetchCels();
      if(this.active){this.sync();this.prepareVisible();}
    },opts);
    // Navigation begins before the editor changes its active layer or playhead.
    document.addEventListener('pointerdown',event=>{if(this.gesture&&!overlay.contains(event.target))this.finish();if(this.selection&&event.target.closest?.('.layer-timeline,.sheet-filmstrip'))this.run(()=>this.applySelection());},{...opts,capture:true});
    this.bind();
  }
  bind(){
    // Resources exist only for reports that carry drawings (or while Draw is
    // open and is about to create one); an animation without drawings must
    // never spawn stores, workers or presenters.
    const report=this.editor.report,owner=drawingResourcesFor(report)??((this.active||report.figure_types?.some(figure=>drawingMetadata(figure)))?this.editor.drawingResources:null);
    if(owner===this.owner)return;this.owner=owner;if(!owner)return;
    owner.onChange=()=>{if(this.surfaceVersion!==owner.surfaceVersion){this.surfaceVersion=owner.surfaceVersion;if(this.state.renderer){this.state.renderer.lastGeometry=null;this.state.renderer.clearArtwork?.();this.state.renderer.clearOnionArtwork?.();}}this.onRender();};owner.onError=this.onError;owner.strokeWorker.onmessage=data=>this.strokeMessage(data);owner.strokeWorker.onerror=error=>{owner.strokeWorker.dispose();this.cancel();this.onError(error);};
  }
  /** Decode the cel under the playhead plus its two unique neighbours each way
   * so onion skins and scrubs never wait on the decode queue. Neighbours queue
   * first: the bounded decode queue drops stale pending jobs oldest-first, so
   * the current cel always survives a burst of seeks. */
  prefetchCels(){
    const owner=this.owner;if(!owner||owner.disposed)return;
    const found=drawingCelPrefetch(this.editor,this.editor.activeLayerId);if(!found)return;
    const miss=error=>{if(error.name!=='AbortError')this.onError(error);};
    for(const figure of found.neighbors)owner.surface(figure).catch(miss);
    if(found.current)owner.surface(found.current).catch(miss);
  }
  run(operation){try{const result=operation();if(result?.catch)result.catch(error=>{this.cancel();if(error.name!=='AbortError')this.onError(error);});return result;}catch(error){this.cancel();this.onError(error);}}
  enter(){if(this.active)return;this.beforeEdit();this.prior={handles:this.state.handles,tool:this.state.tool,rotation:this.state.view.rotation??0,flip:Boolean(this.state.view.flip)};this.active=true;this.state.handles=false;this.state.tool='drawing-brush';this.state.drawing=true;this.cursor=null;this.bind();
    const layers=this.editor.layers.filter(layer=>isDrawingLayer(layer)&&!layer.locked&&layer.visible),target=layers.find(l=>l.id===this.editor.activeLayerId)||layers.find(l=>l.id===this.lastLayer)||layers.at(-1);if(target){this.editor.selectSheetLayer(target.id);this.state.selectedTrackId=target.id;}this.sync();this.prepareVisible();this.onUI();this.onRender();}
  exit(){if(!this.active)return;this.finish();this.applySelection();this.active=false;this.state.drawing=false;this.cursor=null;Object.assign(this.state,{handles:this.prior.handles,tool:this.prior.tool});this.state.view.rotation=this.prior.rotation;this.state.view.flip=this.prior.flip;this.onUI();this.onRender();}
  get tool(){return this.state.tool==='hand'?'pan':this.state.tool.replace('drawing-','');}
  set tool(value){this.setTool(value);}
  setTool(value){this.finish();if(this.selection&&value!=='lasso')this.settleFloating();
    // Brush and eraser remember their own tip, pressure and size settings.
    this.tips??={eraser:{preset:null,size:24,opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,pressureFlow:false,sizeCurve:1,opacityCurve:1,stabilization:0,roundness:1,angle:0,angleMode:'fixed',scatter:0,blend:'normal',alphaLock:false}};
    if(['brush','eraser'].includes(this.tool))this.tips[this.tool]=Object.fromEntries(brushKeys.map(key=>[key,this.settings[key]]));
    if(this.tips[value])Object.assign(this.settings,this.tips[value]);
    this.state.tool=value==='pan'?'hand':'drawing-'+value;if(value==='transform'){try{const t=this.editor.drawingTarget();if(t.object)this.editor.select(t.object.unique_id);}catch{}}this.sync();this.onUI();this.onRender();}
  get pixelClipboard(){return this.editor._drawingPixelClipboard;}
  get exposureLabel(){try{const t=this.editor.drawingTarget();return `${t.figure?'Drawing':'Blank'} · frames ${t.key.tick+1}–${t.end}${this.editor.tick!==t.key.tick?' · editing hold':''}`;}catch{return 'No drawing exposure at this frame';}}
  sync(){if(!this.active)return;try{const t=this.editor.drawingTarget();this.exposure={layerId:t.id,start:t.key.tick,end:t.end};this.lastLayer=t.id;}catch{this.exposure=null;}this.viewport.setAttribute('aria-label','Drawing canvas. B brush, E eraser, G fill, L select pixels, V transform, H pan.');this.overlay.style.cursor=this.tool==='pan'?'grab':this.tool==='transform'?'move':'crosshair';}
  propertyValue(key){key=key.slice(5);if(key==='viewAngle')return (this.state.view.rotation??0)*180/Math.PI;if(key==='selectionScale')return (this.selection?.scale??1)*100;if(key==='selectionAngle')return this.selection?.angle??0;return this.settings[key]*(PERCENT_SETTINGS.includes(key)?100:1);}
  propertySet(key,value){key=key.slice(5);if(key==='viewAngle')this.state.view.rotation=value*Math.PI/180;else if(key==='selectionScale'||key==='selectionAngle'){if(this.ensureFloating()){this.selection[key==='selectionScale'?'scale':'angle']=key==='selectionScale'?value/100:value;this.previewSelection();}}else{this.settings[key]=value/(PERCENT_SETTINGS.includes(key)?100:1);if(['size','opacity','flow','hardness','roundness','angle','scatter','spacingRatio','texture'].includes(key))this.settings.preset=null;}this.onRender();this.paintPreview(this.panel);}
  async prepareVisible(){const owner=this.owner;if(!owner||!this.active||this.gesture)return;let target;try{target=this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const revision=this.editor.revision;try{await owner.surface(target.figure);if(owner===this.owner&&revision===this.editor.revision){this.onRender();}}catch(error){if(error.name!=='AbortError')this.onError(error);}}
  get renderPreview(){const g=this.gesture;if(!g?.target?.created&&!g?.target?.migratedFrom)return null;if(!g.preview){const report={...this.editor.report,figure_types:[...this.editor.report.figure_types,g.target.figure],_styk:{...this.editor.report._styk,layers:{...this.editor.report._styk.layers,assignments:{...this.editor.report._styk.layers.assignments,[g.target.object.unique_id]:g.target.id}}}},frame=createFrame([...this.editor.evaluatedFrame.objects.filter(o=>o.unique_id!==g.target.object.unique_id),g.target.object]);Object.assign(frame,{camera:this.editor.evaluatedFrame.camera});for(const key of ['background_id','background_id_b','background_mix','background_color','_stykBackgroundColor'])if(key in this.editor.evaluatedFrame)frame[key]=this.editor.evaluatedFrame[key];g.preview={report,frame,geometry:buildGeometry(report,frame)};}return g.preview;}
  /** The renderer keeps the presenter even after its store is evicted:
   * presenter() kicks the re-decode, and v2 callers skip the stale data URL. */
  resource(figure){if(!drawingMetadata(figure))return null;return this.owner?.presenter(figure)??null;}
  /** Viewport geometry cached between layout changes: reading it per pointer
   * sample and per overlay frame would force a synchronous layout each time. */
  viewRect(){
    if(!this._viewRect){
      if(!this._viewObserver&&typeof ResizeObserver!=='undefined'){const reset=()=>{this._viewRect=null;};this._viewObserver=new ResizeObserver(reset);this._viewObserver.observe(this.viewport);window.addEventListener('resize',reset,{signal:this.events.signal});window.addEventListener('scroll',reset,{capture:true,passive:true,signal:this.events.signal});}
      const r=this.viewport.getBoundingClientRect();this._viewRect={left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientWidth:this.viewport.clientWidth,clientHeight:this.viewport.clientHeight};
    }
    return this._viewRect;
  }
  point(event){const rect=this.viewRect();return screenToWorld({x:(event.clientX-rect.left)*rect.clientWidth/rect.width,y:(event.clientY-rect.top)*rect.clientHeight/rect.height},{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false});}
  geometryItem(target){let item;if(target.created||target.migratedFrom)item=buildGeometry({...this.editor.report,figure_types:[...this.editor.report.figure_types,target.figure]},createFrame([target.object])).drawables[0];else item=this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)throw new Error('The drawing pose is unavailable.');return item;}
  pixelMatrix(target){return drawingPixelMatrix(this.geometryItem(target));}
  pixel(event,target){return inversePoint(this.pixelMatrix(target),this.point(event));}
  async down(event){
    if(this.gesture){
      // A pointer arriving while the previous stroke is closing queues behind its commit.
      if(this.gesture.kind==='stroke'&&this.gesture.session.ended&&!this.loading)this.loading={id:event.pointerId,sequence:++this.sequence,released:false,samples:[],event:{...pointerSample(event),pointerId:event.pointerId},queued:true};
      return;
    }
    if(this.loading)return;if(event.pointerType==='touch'){if(performance.now()-(this.lastPen??-Infinity)<700)return;this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'pan',start:pointerSample(event),view:{...this.state.view}};return;}if(event.pointerType==='pen')this.lastPen=performance.now();
    if(event.altKey&&this.sampleColor&&['brush','fill'].includes(this.tool)){this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'pick'};this.pickColor(event);return;}
    if((event.ctrlKey||event.metaKey)&&['brush','eraser'].includes(this.tool)){this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'resize',start:pointerSample(event),size:this.settings.size};return;}
    this._viewRect=null;this.beforeEdit();this.viewport.focus({preventScroll:true});this.overlay.setPointerCapture(event.pointerId);
    const sequence=++this.sequence,revision=this.editor.revision,owner=this.owner;
    let target=this.editor.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,world:this.point(event)}),surface;
    const pending=this.loading={id:event.pointerId,sequence,released:event.released??false,samples:event.samples??[],event:pointerSample(event)};
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
    if(this.tool==='fill'){surface.pinned=false;this.settleFloating();await this.fill(target,surface,point);return;}
    if(this.tool==='transform'){if(target.created){surface.pinned=false;return;}this.editor.select(target.object.unique_id);this.editor.beginTranslationDrag('Move drawing');this.gesture={id:event.pointerId,target,surface,kind:'pose',start:this.point(event)};}
    else if(this.tool==='lasso'){
      // Shift adds to the selection and Alt subtracts from it, as in Krita.
      const mode=event.shiftKey?'add':event.altKey?'subtract':'replace',shape=this.settings.selectShape;
      if((this.selection||this.marquee)&&!this.marqueeOn(target))this.cancelSelection();
      if(this.selection&&(mode!=='replace'||!this.selectionContains(point)))this.settleFloating();
      if(!this.selection&&mode==='replace'&&shape!=='wand'&&this.marqueeContains(point))this.ensureFloating();
      if(this.selection){this.gesture={id:event.pointerId,target,surface,kind:'selection-move',start:point,dx:this.selection.dx,dy:this.selection.dy};}
      else if(shape==='wand'){surface.pinned=false;await this.wandSelect(target,surface,point,mode);return;}
      else this.gesture={id:event.pointerId,target,surface,kind:'lasso',shape,mode,start:point,points:[point]};
    }else{
      // Painting keeps the selection outline as a clip mask; a moved or
      // resized floating selection is committed first.
      this.settleFloating();const color=this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16));
      const d=drawingMetadata(target.figure),size=this.settings.size*d.pixelsPerUnit,s={id:++this.strokeId,target,surface,seq:0,sent:new Set(),before:new Map(),pending:[],posted:new Map(),outstanding:0,ended:false,cancelled:false,erase:this.tool==='eraser'||event.button===5||Boolean(event.buttons&32),revision:this.editor.revision,owner:this.owner};
      s.done=new Promise(resolve=>s.resolveDone=resolve);
      this.sessions.set(s.id,s);this.gesture={id:event.pointerId,target,surface,kind:'stroke',session:s};
      // Painting owns the UI thread: publication and thumbnails wait it out.
      s.owner.busy=true;
      const b=this.settings,settings={size,pixelsPerUnit:d.pixelsPerUnit,color,opacity:b.opacity,flow:b.flow,hardness:b.hardness,pressureSize:b.pressureSize,pressureOpacity:b.pressureOpacity,pressureFlow:b.pressureFlow,sizeCurve:b.sizeCurve,opacityCurve:b.opacityCurve,stabilization:b.stabilization,spacingRatio:b.spacingRatio??.12,texture:b.texture??0,roundness:b.roundness??1,angle:b.angle??0,angleMode:b.angleMode??'fixed',scatter:b.scatter??0,blend:b.blend??'normal',alphaLock:Boolean(b.alphaLock),erase:s.erase,seed:s.id,mask:this.marqueeOn(target)?this.marquee.mask:null};
      // The path runs here so every dab's extent is known before dispatch:
      // the worker is seeded with exactly the tiles its dabs can reach.
      // Symmetry mirrors each input sample into its own path so mirrored
      // strokes keep even spacing; all dabs share one stroke and undo step.
      s.brush=normalizeBrush(settings);s.matrix=this.pixelMatrix(target);
      const report=this.editor.report,axisX=report.canvas_width/2,axisY=report.canvas_height/2,mirrors=[p=>p];
      if(b.mirrorX)mirrors.push(p=>({x:2*axisX-p.x,y:p.y}));if(b.mirrorY)mirrors.push(p=>({x:p.x,y:2*axisY-p.y}));if(b.mirrorX&&b.mirrorY)mirrors.push(p=>({x:2*axisX-p.x,y:2*axisY-p.y}));
      s.paths=mirrors.map(map=>({map,path:new StrokePath(s.brush,dab=>s.pending.push(dab))}));s.path=s.paths[0].path;
      this.owner.strokeWorker.post({kind:'begin',stroke:s.id,settings});
      // Shift continues from the previous stroke's end in a straight line.
      const last=this.lastStroke;if(event.shiftKey&&last&&last.layerId===target.id&&last.celId===drawingMetadata(target.figure).celId)this.sampleStroke({...pending.event,world:last.world});
      this.sampleStroke(pending.event);
    }
    for(const sample of pending.samples)this.move({...sample,pointerId:event.pointerId});if(pending.released)this.finish();this.onRender();
  }
  /** Feed a pixel-space sample to the stroke path; the dabs it emits post to
   * the stroke worker in one rAF-paced batch. */
  sampleStroke(event){
    const g=this.gesture,s=g?.session;
    if(g?.kind!=='stroke'||s.ended||s.cancelled)return;
    // The cel pose is fixed for the whole stroke: map through its cached matrix.
    const world=event.world??this.point(event),pen=event.pointerType==='pen',pressure=pen?event.pressure||.05:1;
    // Pen tilt is a screen-space lean; map it through the view and cel pose
    // so tilt-driven tips point the same way on a rotated canvas.
    const lean=pen&&(event.tiltX||event.tiltY)&&!event.world?this.point({clientX:event.clientX+Math.sin(event.tiltX*Math.PI/180)*16,clientY:event.clientY+Math.sin(event.tiltY*Math.PI/180)*16}):null;
    for(const {map,path} of s.paths){
      const p=inversePoint(s.matrix,map(world));let ax=0,ay=0;
      if(lean){const q=inversePoint(s.matrix,map(lean)),n=Math.hypot(q.x-p.x,q.y-p.y);if(n>1e-9){ax=(q.x-p.x)/n;ay=(q.y-p.y)/n;}}
      path.sample({x:p.x,y:p.y,pressure,time:event.timeStamp,ax,ay});
    }
    s.lastWorld=world;
    if(!s.raf)s.raf=requestAnimationFrame(()=>{s.raf=null;this.flushStroke(s);});
  }
  flushStroke(s){
    if(this.sessions.get(s.id)!==s||!s.pending.length)return;
    const dabs=s.pending;s.pending=[];
    const tiles=[],store=s.surface.store;
    for(const dab of dabs){
      const [x0,y0,x1,y1]=dabExtent(s.brush,dab);
      for(let ty=Math.floor(y0/TILE);ty*TILE<y1;ty++)for(let tx=Math.floor(x0/TILE);tx*TILE<x1;tx++){
        const key=tileKey(tx,ty);if(s.sent.has(key))continue;s.sent.add(key);
        const tile=store.get(tx,ty);tiles.push({tx,ty,pixels:tile?tile.pixels.slice().buffer:null});
      }
    }
    const seq=++s.seq;s.outstanding++;s.posted.set(seq,performance.now());
    this.strokeStats.batches++;this.strokeStats.dabs=(this.strokeStats.dabs??0)+dabs.length;this.strokeStats.maxQueueDepth=Math.max(this.strokeStats.maxQueueDepth,s.outstanding);
    this.owner.strokeWorker.post({kind:'dabs',stroke:s.id,seq,dabs,tiles},tiles.map(t=>t.pixels).filter(Boolean));
  }
  strokeMessage(data){
    const s=this.sessions.get(data.stroke);if(!s)return;
    if(data.kind==='error'){const message=data.message;this.cancel();this.onError(new Error(message));return;}
    if(data.kind==='tiles'){
      s.outstanding=Math.max(0,s.outstanding-1);const posted=s.posted.get(data.seq);s.posted.delete(data.seq);
      if(posted!=null)this.strokeStats.lastRoundTripMs=performance.now()-posted;
      if(s.cancelled)return;
      const store=s.surface.store;
      for(const t of data.tiles){const key=tileKey(t.tx,t.ty);if(!s.before.has(key))s.before.set(key,store.get(t.tx,t.ty)?.pixels.slice()??null);store.adopt(t.tx,t.ty,new Uint8ClampedArray(t.pixels));}
      if(data.tiles.length){this.owner.present(s.surface,data.dirty);this.onRender();}
      return;
    }
    if(data.kind==='done'){this.sessions.delete(s.id);this.commitStroke(s,data.changes);}
  }
  restoreStroke(s){
    const store=s.surface.store;let dirty=null;
    for(const [key,before] of s.before){const [tx,ty]=parseTileKey(key);before?store.set(tx,ty,before):store.delete(tx,ty);dirty=unionRects(dirty,{x:tx*TILE,y:ty*TILE,width:TILE,height:TILE});}
    s.before.clear();
    if(dirty)this.owner?.present(s.surface,dirty);
  }
  commitStroke(s,changes){
    const g=this.gesture,valid=g?.session===s&&!s.cancelled&&s.owner===this.owner&&s.revision===this.editor.revision;
    if(g?.session===s)this.gesture=null;
    try{
      if(valid){try{this.editor.commitDrawingPixels(s.target,changes,s.erase?'Erase stroke':'Brush stroke',{resident:true});}catch(error){this.restoreStroke(s);this.onError(error);}}
      else this.restoreStroke(s);
    }finally{
      s.resolveDone?.();
      s.owner.busy=false;
      s.surface.pinned=Boolean(this.selection?.surface===s.surface);
      // The screen already shows the committed tiles; restores repaint their own rect.
      if(this.selection?.surface===s.surface)this.previewSelection();else this.owner.discard(s.target.figure);
      if(g?.session===s&&this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);
      this.sync();this.onUI();this.onRender();
      const queued=this.loading?.queued?this.loading:null;
      if(queued&&!this.gesture){this.loading=null;this.run(()=>this.down({...queued.event,samples:queued.samples,released:queued.released}));}
    }
  }
  move(event){this.cursor=pointerSample(event);if(this.loading?.id===event.pointerId){this.loading.samples.push(pointerSample(event));return;}const g=this.gesture;if(!g||g.id!==event.pointerId){this.onRender();return;}
    if(g.kind==='pan'){const rect=this.viewRect();this.state.view.x=g.view.x+(event.clientX-g.start.clientX)*rect.clientWidth/rect.width;this.state.view.y=g.view.y+(event.clientY-g.start.clientY)*rect.clientHeight/rect.height;}
    else if(g.kind==='stroke'){if(!g.session.ended){const samples=event.getCoalescedEvents?.();for(const sample of samples?.length?samples:[event])this.sampleStroke(sample);}}
    else if(g.kind==='pose'){const p=this.point(event);this.editor.moveSelection(p.x-g.start.x,p.y-g.start.y,{fromStart:true});}
    else if(g.kind==='lasso'){const p=this.pixel(event,g.target);if(g.shape==='rect')g.points=rectPoints(g.start,p);else if(g.shape==='ellipse')g.points=ellipsePoints(g.start,p);else if(g.points.length<8192&&Math.hypot(p.x-g.points.at(-1).x,p.y-g.points.at(-1).y)>1)g.points.push(p);}
    else if(g.kind==='resize'){this.settings.size=Math.max(.5,Math.min(2048,g.size*2**((event.clientX-g.start.clientX)/120)));this.settings.preset=null;this.cursor=g.start;this.paintPreview(this.panel);}
    else if(g.kind==='pick')this.pickColor(event);
    else if(g.kind==='selection-move'){const p=this.pixel(event,g.target);this.selection.dx=g.dx+p.x-g.start.x;this.selection.dy=g.dy+p.y-g.start.y;this.previewSelection();}
    this.onRender();
  }
  up(event,cancel=false){if(this.loading?.id===event.pointerId){if(cancel){this.sequence++;this.loading=null;}else this.loading.released=true;return;}const g=this.gesture;if(!g||g.id!==event.pointerId)return;if(g.kind==='stroke'&&g.session.ended)return;cancel?this.cancel():this.finish();}
  finish(){const g=this.gesture;
    if(g?.kind==='stroke'&&g.session.ended)return; // the done reply completes the commit
    if(this.loading)this.cancel();if(!g)return;
    if(['pan','pick','resize'].includes(g.kind)){this.gesture=null;if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);if(g.kind!=='pan')this.onUI();return;}
    if(g.kind==='stroke'){
      const s=g.session;s.ended=true;cancelAnimationFrame(s.raf);s.raf=null;
      if(s.lastWorld)this.lastStroke={layerId:s.target.id,celId:drawingMetadata(s.target.figure).celId,world:s.lastWorld};
      for(const {path} of s.paths)path.finish();this.flushStroke(s);this.owner.strokeWorker.post({kind:'end',stroke:s.id});
      if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);
      return; // the gesture stays closing until the worker's done arrives
    }
    this.gesture=null;try{
    if(g.kind==='pose')this.editor.commitDrag();
    else if(g.kind==='lasso')this.selectShape(g);
  }finally{g.surface.pinned=Boolean(this.selection?.surface===g.surface);if(this.selection?.surface===g.surface)this.previewSelection();else{this.owner.present(g.surface);this.owner.discard(g.target.figure);}if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.sync();this.onUI();this.onRender();}}
  cancel(){this.sequence++;const pending=this.loading;this.loading=null;if(pending&&this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);const g=this.gesture;if(!g){this.fillAbort?.abort();return;}this.gesture=null;if(g.kind==='pan'){Object.assign(this.state.view,g.view);this.onRender();return;}if(g.kind==='pick'){this.pickAbort?.abort();if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);return;}if(g.kind==='resize'){this.settings.size=g.size;if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.onUI();this.onRender();return;}if(g.kind==='stroke'){const s=g.session;s.cancelled=true;cancelAnimationFrame(s.raf);s.raf=null;this.sessions.delete(s.id);s.resolveDone?.();s.owner.busy=false;this.owner.strokeWorker.post({kind:'cancel',stroke:s.id});this.restoreStroke(s);}if(g.kind==='pose')this.editor.cancelDrag();if(g.kind==='selection-move')this.cancelSelection();g.surface.pinned=false;this.owner.present(g.surface);this.owner.discard(g.target.figure);this.prepareVisible();if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.onRender();}
  async barrier(options){this.finish();this.applySelection();const closing=this.gesture?.session;if(closing?.ended)await closing.done;if(this.loading)throw new Error('Wait for the drawing to finish loading.');if(this.fillAbort)throw new Error('Finish or cancel the fill first.');await drawingBarrier(this.editor.report,options);}
  /** Fill bounds = stage ∪ artwork ∪ viewport, in the cel's pixel space. */
  fillBounds(target,store){
    const matrix=this.pixelMatrix(target),toPixel=p=>inversePoint(matrix,p);
    const report=this.editor.report,stage=[[0,0],[report.canvas_width,0],[report.canvas_width,report.canvas_height],[0,report.canvas_height]].map(([x,y])=>toPixel({x,y}));
    const rect=this.viewport.getBoundingClientRect(),view=[[rect.left,rect.top],[rect.right,rect.top],[rect.right,rect.bottom],[rect.left,rect.bottom]].map(([clientX,clientY])=>toPixel(this.point({clientX,clientY})));
    const box=points=>({x:Math.floor(Math.min(...points.map(p=>p.x))),y:Math.floor(Math.min(...points.map(p=>p.y))),width:Math.ceil(Math.max(...points.map(p=>p.x)))-Math.floor(Math.min(...points.map(p=>p.x))),height:Math.ceil(Math.max(...points.map(p=>p.y)))-Math.floor(Math.min(...points.map(p=>p.y)))});
    return unionRects(unionRects(box(stage),box(view)),store.bounds);
  }
  async fill(target,surface,point){
    const controller=this.fillAbort=new AbortController(),revision=this.editor.revision,owner=this.owner;surface.pinned=true;owner.busy=true;this.onStatus('Filling drawing… Escape cancels.');
    try{
      const bounds=this.fillBounds(target,surface.store);
      if(!bounds)return;if(bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('Zoom in before filling: the fill area exceeds 16 megapixels.');
      let source;
      if(this.settings.sampleAll)source=await this.compositeSource(target,bounds);
      const tiles=[...TileStore.tilesInRect(bounds.x,bounds.y,bounds.width,bounds.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
      const result=await owner.worker.request('fill',{bounds,tiles,options:{...point,color:[...this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16)),Math.round(this.settings.opacity*255)],tolerance:this.settings.tolerance,expansion:this.settings.expansion,gap:this.settings.gap,clip:this.marqueeOn(target)?this.marquee.mask:null},source},{transfer:[...tiles.map(t=>t.pixels),...(source?[source]:[])]});
      if(controller.signal.aborted||owner!==this.owner||revision!==this.editor.revision)throw new DOMException('Fill superseded by another edit.','AbortError');
      this.editor.commitDrawingPixels(target,result.tiles,'Fill drawing');this.onStatus('Drawing filled.');
    }finally{surface.pinned=false;owner.busy=false;if(this.fillAbort===controller)this.fillAbort=null;this.onRender();}
  }
  /** Visible artwork of every layer rasterized into the cel's pixel space. */
  async compositeSource(target,bounds){await this.barrierForComposite();const c=canvas(bounds.width,bounds.height),ctx=c.getContext('2d'),inverse=new DOMMatrix(this.pixelMatrix(target)).inverse();ctx.setTransform(inverse.a,inverse.b,inverse.c,inverse.d,inverse.e-bounds.x,inverse.f-bounds.y);drawGeometry(ctx,{drawables:this.editor.geometry.drawables.filter(i=>this.editor.getLayer(this.editor.layerForUid(i.obj.unique_id))?.visible!==false)},this.getResources());const data=ctx.getImageData(0,0,c.width,c.height).data.buffer;c.width=c.height=1;return data;}
  async barrierForComposite(){await drawingBarrier(this.editor.report);const assets=this.editor.geometry.drawables.filter(i=>i.type==='image');await Promise.all(assets.map(async i=>{const image=this.getResources().image(this.getResources().url(i.asset));if(image&&!image.complete)await image.decode?.();}));}
  /** The selection outline is the canonical selection: a pixel mask on one
   * cel that clips painting and fills. Moving, scaling or rotating selected
   * pixels floats them into `this.selection`, derived from the outline. */
  setMarquee(target,surface,mask){
    this.marquee=mask?{celId:drawingMetadata(target.figure).celId,target,surface,mask,edges:maskEdges(mask)}:null;
    this.onUI();this.onRender();return this.marquee;
  }
  marqueeOn(target){const m=this.marquee;if(!m||!target?.figure)return false;const id=drawingMetadata(target.figure).celId;return m.celId===id||m.celId===target.migratedFrom;}
  marqueeContains(point){const m=this.marquee?.mask;if(!m)return false;const px=Math.floor(point.x)-m.x,py=Math.floor(point.y)-m.y;return px>=0&&py>=0&&px<m.width&&py<m.height&&Boolean(m.mask[py*m.width+px]);}
  /** Combine a finished lasso, rectangle or ellipse gesture with the outline. */
  selectShape(g){
    let shape;
    if('maskOverride' in g)shape=g.maskOverride??null;
    else{const points=g.shape==='lasso'||!g.shape?g.points:g.points?.length>2?g.points:null,mask=points?lassoMask(points):null;shape=mask&&mask.mask.some(Boolean)?mask:null;}
    if(!shape&&g.mode==='replace'){this.cancelSelection();return;}
    const combined=combineMasks(this.marqueeOn(g.target)?this.marquee.mask:null,shape,g.mode??'replace');
    this.cancelSelection();if(!combined)return;
    this.setMarquee(g.target,g.surface,combined);this.float();
  }
  /** Magic wand: select the contiguous region similar to the clicked pixel. */
  async wandSelect(target,surface,point,mode){
    const owner=this.owner,revision=this.editor.revision,bounds=this.fillBounds(target,surface.store);
    if(!bounds)return;if(bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('Zoom in before selecting: the area exceeds 16 megapixels.');
    const source=this.settings.sampleAll?await this.compositeSource(target,bounds):undefined;
    const tiles=[...TileStore.tilesInRect(bounds.x,bounds.y,bounds.width,bounds.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
    const result=await owner.worker.request('flood-mask',{bounds,tiles,options:{...point,tolerance:this.settings.tolerance,gap:this.settings.gap},source},{transfer:[...tiles.map(t=>t.pixels),...(source?[source]:[])]});
    if(owner!==this.owner||revision!==this.editor.revision)return;
    this.selectShape({target,surface,mode,shape:'mask',points:null,maskOverride:result.mask});
  }
  /** Float the outlined pixels so they can move, scale or rotate. */
  ensureFloating(){if(this.selection)return this.selection;if(!this.marquee)return null;this.float();return this.selection;}
  float(){
    const m=this.marquee;if(!m||this.selection)return;
    const mask=m.mask,store=m.surface.store;
    const s=this.selection={cx:mask.x+mask.width/2,cy:mask.y+mask.height/2,target:m.target,surface:m.surface,mask,original:new Map(),touched:new Set(),dx:0,dy:0,scale:1,angle:0};
    // Snapshot the mask region content once: cutout keeps masked pixels, base
    // keeps the rest. The store snapshot only covers tiles the preview touches.
    const region=store.readRect(mask.x,mask.y,mask.width,mask.height),cut=new Uint8ClampedArray(region),base=new Uint8ClampedArray(region);
    for(let p=0;p<mask.width*mask.height;p++){if(mask.mask[p])base[p*4+3]=0;else cut[p*4+3]=0;}
    s.cutout=canvas(mask.width,mask.height);s.cutout.getContext('2d').putImageData(new ImageData(cut,mask.width,mask.height),0,0);
    // `region` keeps the exact pre-preview bytes: the canvas composite preview
    // degrades RGB under partial alpha, so copy/cut must not read it back.
    s.basePixels=base;s.originalPixels=region;m.surface.pinned=true;
    // Delete and cut record undo from these originals even if nothing moved.
    for(const [tx,ty] of TileStore.tilesInRect(mask.x,mask.y,mask.width,mask.height))s.original.set(tileKey(tx,ty),store.get(tx,ty)?.pixels.slice()??null);
    this.previewSelection();
  }
  /** Legacy entry point: select a lasso polygon and float it immediately. */
  makeSelection(g){this.selectShape({...g,mode:'replace',shape:'lasso'});}
  /** Commit a moved floating selection; an untouched one just lands back. */
  settleFloating(){const s=this.selection;if(!s)return;if(s.dx||s.dy||s.scale!==1||s.angle)this.applySelection();else this.endSelection(true);}
  previewSelection(){
    const s=this.selection;if(!s)return;const store=s.surface.store,B=s.mask;
    // An untransformed float shows the exact stored pixels; compositing them
    // through a canvas would only round partially transparent colours.
    if(!s.dx&&!s.dy&&s.scale===1&&!s.angle){for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?store.set(tx,ty,o):store.delete(tx,ty);}s.touched.clear();this.owner.present(s.surface,{x:B.x,y:B.y,width:B.width,height:B.height});this.onRender();return;}
    const angle=s.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),sc=s.scale;
    const t=p=>({x:s.cx+s.dx+cos*(p.x-s.cx)*sc-sin*(p.y-s.cy)*sc,y:s.cy+s.dy+sin*(p.x-s.cx)*sc+cos*(p.y-s.cy)*sc});
    const corners=[[B.x,B.y],[B.x+B.width,B.y],[B.x,B.y+B.height],[B.x+B.width,B.y+B.height]].map(([x,y])=>t({x,y}));
    const dx0=Math.min(B.x,...corners.map(p=>p.x)),dy0=Math.min(B.y,...corners.map(p=>p.y));
    const R=tileAlignedRect(dx0,dy0,Math.max(B.x+B.width,...corners.map(p=>p.x))-dx0,Math.max(B.y+B.height,...corners.map(p=>p.y))-dy0);
    for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?store.set(tx,ty,o):store.delete(tx,ty);}
    s.touched.clear();
    for(const [tx,ty] of TileStore.tilesInRect(R.x,R.y,R.width,R.height)){const key=tileKey(tx,ty);if(!s.original.has(key))s.original.set(key,store.get(tx,ty)?.pixels.slice()??null);s.touched.add(key);}
    if(!s.preview||s.preview.width!==R.width||s.preview.height!==R.height)s.preview=canvas(R.width,R.height);
    // A CPU-backed preview keeps compositing deterministic: accelerated
    // canvases switch backends after readbacks and round partial alpha differently.
    const ctx=s.preview.getContext('2d',{willReadFrequently:true}),tile=canvas(TILE,TILE),tctx=tile.getContext('2d');
    ctx.clearRect(0,0,R.width,R.height);
    for(const [tx,ty] of TileStore.tilesInRect(R.x,R.y,R.width,R.height)){const current=store.get(tx,ty);if(!current)continue;tctx.putImageData(new ImageData(current.pixels,TILE,TILE),0,0);ctx.drawImage(tile,tx*TILE-R.x,ty*TILE-R.y);}
    ctx.putImageData(new ImageData(s.basePixels,B.width,B.height),B.x-R.x,B.y-R.y);
    ctx.save();ctx.translate(s.cx+s.dx-R.x,s.cy+s.dy-R.y);ctx.rotate(angle);ctx.scale(sc,sc);ctx.drawImage(s.cutout,B.x-s.cx,B.y-s.cy);ctx.restore();
    store.writeRect(R.x,R.y,R.width,R.height,ctx.getImageData(0,0,R.width,R.height).data);
    this.owner.present(s.surface,R);this.onRender();
  }
  selectionContains(point){const s=this.selection;if(!s)return false;const B=s.mask,angle=-s.angle*Math.PI/180,x=point.x-s.cx-s.dx,y=point.y-s.cy-s.dy,px=Math.floor(s.cx+(Math.cos(angle)*x-Math.sin(angle)*y)/s.scale),py=Math.floor(s.cy+(Math.sin(angle)*x+Math.cos(angle)*y)/s.scale);return px>=B.x&&py>=B.y&&px<B.x+B.width&&py<B.y+B.height&&Boolean(B.mask[(py-B.y)*B.width+(px-B.x)]);}
  applySelection(){const s=this.selection;if(!s)return;if(!s.dx&&!s.dy&&s.scale===1&&!s.angle){this.cancelSelection();return;}try{const tiles=tileChanges(s.surface.store,s.original);this.editor.commitDrawingPixels(s.target,tiles,'Transform selected pixels');}finally{this.endSelection(false);this.marquee=null;this.onUI();this.onRender();}}
  endSelection(restore=true){const s=this.selection;if(!s)return;this.selection=null;const store=s.surface.store;
    if(restore)for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?store.set(tx,ty,o):store.delete(tx,ty);}
    this.owner.present(s.surface);s.surface.pinned=false;if(s.cutout)s.cutout.width=s.cutout.height=1;if(s.preview)s.preview.width=s.preview.height=1;}
  /** Deselect: drop the floating preview and the outline. */
  cancelSelection(){this.endSelection(true);if(this.marquee){this.marquee=null;this.onUI();this.onRender();}}
  async action(action){this.finish();const e=this.editor,ids=[e.activeLayerId];
    if(action==='new'){const layer=e.createDrawingLayer();this.state.selectedTrackId=layer.id;this.getTimeline()?.selectTrack?.(layer.id);this.sync();this.onUI();return;}
    if(!SELECTION_ACTIONS.includes(action))this.applySelection();
    if(['select-all','invert-selection'].includes(action)){
      this.settleFloating();const target=e.drawingTarget();if(!target.figure)throw new Error('Paint a drawing before selecting its pixels.');
      const surface=await this.owner.surface(target.figure),bounds=this.fillBounds(target,surface.store);if(!bounds)return;
      const mask=action==='select-all'?rectMask(bounds):invertMask(this.marqueeOn(target)?this.marquee.mask:null,bounds);
      this.cancelSelection();if(mask)this.setMarquee(target,surface,mask);return;
    }
    if(action==='deselect')return this.cancelSelection();
    if(action==='fill-selection'){
      this.settleFloating();const m=this.marquee;if(!m)throw new Error('Select pixels before filling the selection.');
      const target=e.drawingTarget();if(!this.marqueeOn(target))throw new Error('The selection belongs to another drawing.');
      const owner=this.owner,revision=e.revision,surface=await owner.surface(target.figure),tiles=[...TileStore.tilesInRect(m.mask.x,m.mask.y,m.mask.width,m.mask.height)].map(([tx,ty])=>surface.store.get(tx,ty)).filter(Boolean).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
      const result=await owner.worker.request('fill-mask',{tiles,mask:m.mask,color:[...this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16)),Math.round(this.settings.opacity*255)]},{transfer:tiles.map(t=>t.pixels)});
      if(owner!==this.owner||revision!==e.revision)throw new DOMException('The drawing changed before the fill.','AbortError');
      return e.commitDrawingPixels(target,result.tiles,'Fill selection');
    }
    if(action==='mirror-x'||action==='mirror-y'){const key=action==='mirror-x'?'mirrorX':'mirrorY';this.settings[key]=!this.settings[key];this.onUI();this.onRender();return;}
    if(action==='flip-view'){this.state.view.flip=!this.state.view.flip;this.onUI();this.onRender();return;}
    if(action==='blank')return e.drawingKey(ids,e.tick,{blank:true});if(action==='copy-key'){if(!e.drawingKey(ids))this.onStatus('This cell already starts a drawing. Use Next copy to add time.');return;}
    if(action==='extend')return e.extendDrawing(ids,this.settings.length);if(action==='next-blank'||action==='next-copy')return e.nextDrawing(ids,{blank:action==='next-blank',length:this.settings.length});
    if(action==='apply-selection')return this.applySelection();if(action==='cancel-selection')return this.cancelSelection();if(action==='retry')return this.barrier();
    if(action==='reset-rotation'){this.state.view.rotation=0;this.onRender();return;}
    if(action==='delete-pixels'){
      const s=this.ensureFloating();if(!s)return;const B=s.mask;
      // Same removal as cut-pixels, without the clipboard write.
      try{
        for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?s.surface.store.set(tx,ty,o):s.surface.store.delete(tx,ty);}
        s.surface.store.writeRect(B.x,B.y,B.width,B.height,s.basePixels);
        e.commitDrawingPixels(s.target,tileChanges(s.surface.store,s.original),'Delete selected pixels');
      }finally{this.endSelection(false);this.marquee=null;this.onUI();}
      return;
    }
    if(action==='duplicate-layer'){await this.barrier();const source=e.getLayer(e.activeLayerId),end=e.report._styk.layerSheet.tracks[source.id].end;const old=e._sheetClipboard;try{e.sheetCopyFrames([source.id],0,end-1);return e.movieclipBatch('Duplicate drawing layer',()=>{const layer=e.createLayer(source.name+' copy',{drawing:true});e.sheetPasteFrames([layer.id],0);});}finally{e._sheetClipboard=old;}}
    if(['copy-pixels','cut-pixels'].includes(action))return this.getClipboard().copy('drawing-pixels',async()=>{
      const s=this.ensureFloating();if(!s)throw new Error('Select pixels with the lasso first.');
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
      if(action==='cut-pixels'){try{for(const key of s.touched){const o=s.original.get(key),[tx,ty]=key.split(',').map(Number);o?s.surface.store.set(tx,ty,o):s.surface.store.delete(tx,ty);}s.surface.store.writeRect(B.x,B.y,B.width,B.height,s.basePixels);const tiles=tileChanges(s.surface.store,s.original);e.commitDrawingPixels(s.target,tiles,'Cut selected pixels');}finally{this.endSelection(false);this.marquee=null;}}return true;
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
        const result=await owner.worker.request('paste',{bounds,tiles,clip:{width:clip.width,height:clip.height,dataUrl:clip.dataUrl},x,y,ratio:rr},{transfer:tiles.map(t=>t.pixels)});
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

  change(event){this.finish();const input=event.target,name=input.dataset.drawSetting;if(!name)return;this.settings[name]=input.type==='checkbox'?input.checked:input.type==='color'||input.dataset.drawText!==undefined?input.value:Number(input.value);if(['blend','angleMode','alphaLock','pressureFlow'].includes(name))this.settings.preset=null;this.sync();this.onUI();}
  /** Alt-click/drag with the brush or fill picks the visible colour. */
  pickColor(event){
    if(!this.sampleColor||this.picking)return;this.pickAbort?.abort();const abort=this.pickAbort=new AbortController();this.picking=true;
    this.sampleColor(event.clientX,event.clientY,abort.signal).then(rgb=>{if(abort.signal.aborted||!Array.isArray(rgb))return;this.settings.color=hexColor(rgb);this.onUI();this.paintPreview(this.panel);},error=>{if(!abort.signal.aborted&&!/cancel|superseded/i.test(error.message))this.onStatus(error.message);}).finally(()=>{this.picking=false;});
  }
  /** The inspector's live brush sample, rasterized by the real stroke engine so
   * hardness, flow, opacity, texture and pressure render faithfully. Preview
   * pixels cap the brush at 30 px so the dab stays readable; pixelsPerUnit
   * keeps the stabilization pull honest at that capped scale. Any failure here
   * must never break the inspector. */
  paintPreview(root){
    const preview=root?.querySelector?.('[data-brush-preview]');if(!preview)return;
    try{
      const dpr=window.devicePixelRatio||1,w=Math.round(preview.clientWidth*dpr),h=Math.round(preview.clientHeight*dpr);
      if(w<8||h<8)return;
      if(preview.width!==w||preview.height!==h){preview.width=w;preview.height=h;}
      const s=this.settings,erase=this.tool==='eraser',color=s.color.slice(1).match(/../g).map(n=>parseInt(n,16));
      const px=Math.max(1,Math.min(30,s.size)),ppu=px/Math.max(.5,s.size);
      const pad=Math.ceil(px/2)+3,span=Math.max(1,w-2*pad),mid=h/2,amp=Math.max(0,Math.min(h*.22,mid-pad-2));
      const store=new TileStore();
      if(erase){
        // A solid mid-gray band lets the transparent erase cut show the
        // checkerboard behind the canvas.
        const band={x:pad,y:Math.floor(mid-amp-px*.6),width:span,height:Math.max(1,Math.ceil(2*(amp+px*.6)))};
        for(const [tx,ty] of TileStore.tilesInRect(band.x,band.y,band.width,band.height))store.set(tx,ty,new Uint8ClampedArray([136,136,136,255]));
      }
      const stroke=new DrawingStroke(store,{size:px,color,opacity:s.opacity,flow:s.flow,hardness:s.hardness,pressureSize:s.pressureSize,pressureOpacity:s.pressureOpacity,pressureFlow:s.pressureFlow,sizeCurve:s.sizeCurve,opacityCurve:s.opacityCurve,stabilization:s.stabilization,spacingRatio:s.spacingRatio??.12,texture:s.texture??0,roundness:s.roundness??1,angle:s.angle??0,angleMode:s.angleMode??'fixed',scatter:s.scatter??0,erase,seed:1,pixelsPerUnit:ppu});
      const n=40;
      for(let i=0;i<n;i++){const t=i/(n-1);stroke.sample({x:pad+span*t,y:mid+Math.sin(t*Math.PI*2)*amp,pressure:.15+.85*Math.sin(Math.PI*t),time:i});}
      stroke.finish();
      const bounds=store.bounds;if(!bounds)return;
      const ctx=preview.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.putImageData(new ImageData(store.readRect(bounds.x,bounds.y,bounds.width,bounds.height),bounds.width,bounds.height),bounds.x,bounds.y);
    }catch{}
  }
  overlayDraw(ctx){
    if(!this.active)return;let target;try{target=this.gesture?.target??this.editor.drawingTarget();}catch{target=null;}
    const view={report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false};
    ctx.save();
    // Symmetry axes through the stage centre.
    if(this.settings.mirrorX||this.settings.mirrorY){
      const r=this.editor.report,line=(a,b)=>{const p=worldToScreen(a,view),q=worldToScreen(b,view);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();};
      ctx.setLineDash([6,6]);ctx.lineWidth=1;ctx.strokeStyle='rgba(232,64,160,.85)';
      if(this.settings.mirrorX)line({x:r.canvas_width/2,y:-1e5},{x:r.canvas_width/2,y:1e5});
      if(this.settings.mirrorY)line({x:-1e5,y:r.canvas_height/2},{x:1e5,y:r.canvas_height/2});
    }
    const item=target?.figure?(this.renderPreview?.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id)??this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image')):null;
    const outline=this.marquee&&(this.marqueeOn(target)?this.marquee:null);
    const matrix=item?drawingPixelMatrix(item):outline?this.pixelMatrix(outline.target):null;
    if(matrix){
      const g=this.gesture,screen=p=>worldToScreen(transformPoint(matrix,p),view);
      // Pixel space → screen as one affine transform for the outline path.
      const o=screen({x:0,y:0}),ux=screen({x:1,y:0}),uy=screen({x:0,y:1}),unit=Math.hypot(ux.x-o.x,ux.y-o.y)||1;
      if(outline){
        const s=this.selection;ctx.save();ctx.transform(ux.x-o.x,ux.y-o.y,uy.x-o.x,uy.y-o.y,o.x,o.y);
        if(s){ctx.translate(s.cx+s.dx,s.cy+s.dy);ctx.rotate(s.angle*Math.PI/180);ctx.scale(s.scale,s.scale);ctx.translate(-s.cx,-s.cy);}
        const path=outline.path??=(()=>{const p=new Path2D(),e=outline.edges,m=outline.mask;if(!e){p.rect(m.x,m.y,m.width,m.height);return p;}for(let i=0;i<e.length;i+=4){p.moveTo(e[i],e[i+1]);p.lineTo(e[i+2],e[i+3]);}return p;})();
        const width=1/(unit*(s?.scale??1));ctx.lineWidth=width*1.5;ctx.setLineDash([]);ctx.strokeStyle='rgba(255,255,255,.9)';ctx.stroke(path);
        ctx.lineWidth=width;ctx.setLineDash([4*width,4*width]);ctx.strokeStyle='#2878ed';ctx.stroke(path);ctx.restore();
      }
      const points=g?.kind==='lasso'?g.points:null;
      if(points?.length){ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.strokeStyle='#2878ed';ctx.beginPath();points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();}
      if(this.cursor&&target?.figure&&this.gesture?.kind!=='pan'&&this.gesture?.kind!=='pick'&&this.state.drag?.kind!=='pan'&&['brush','eraser'].includes(this.tool)){
        const d=drawingMetadata(target.figure),center=worldToScreen(this.point(this.cursor),view),radius=Math.max(1,this.settings.size*d.pixelsPerUnit/2*unit),round=this.settings.roundness??1,angle=(this.settings.angle??0)*Math.PI/180+Math.atan2(ux.y-o.y,ux.x-o.x);
        ctx.setLineDash([]);ctx.beginPath();ctx.ellipse(center.x,center.y,radius,Math.max(1,radius*round),angle,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.stroke();
      }
    }
    ctx.restore();
  }
  destroy(){this.cancel();this.cancelSelection();this.events.abort();this._viewObserver?.disconnect();this.owner?.dispose();}
}
