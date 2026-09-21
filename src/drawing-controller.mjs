import {strokeRegion} from './drawing-stroke-region.mjs';
import {BRUSH_PRESETS} from './drawing-view.mjs';
import {DrawingStroke} from './drawing-pixels.mjs';
import {lassoBounds,lassoContains,selectionStores} from './drawing-lasso.mjs';
import {drawingMetadata,migrateDrawingFigure,isDrawingLayer,drawingPixelMatrix,inversePoint,transformPoint} from './drawing-model.mjs';
import {TILE,tileKey,parseTileKey,TileStore} from './drawing-tiles.mjs';
import {drawingBarrier,drawingResourcesFor} from './drawing-resources.mjs';
import {drawingCelPrefetch} from './onion-skin.mjs';
import {buildGeometry,drawGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {screenToWorld,worldToScreen} from './renderer-geometry.mjs';
import {TRANSFORM_BYTES,transformSupportBounds,tileIntersects,inverseMatrix,multiplyMatrix,indexedTileCoverage} from './drawing-transform.mjs';
import {validatePixelClipboard} from './drawing-clipboard.mjs';
import {selectionMatrix,selectionTiles,selectionPresenter} from './drawing-selection.mjs';

const pointerSample=e=>({clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,pointerType:e.pointerType,timeStamp:e.timeStamp,button:e.button,buttons:e.buttons});
const yieldToInput=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0));
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const brushKeys=['preset','size','opacity','flow','hardness','pressureSize','pressureOpacity','sizeCurve','opacityCurve','stabilization','spacingRatio','texture'];
const unionRects=(a,b)=>{if(!a)return b?{...b}:null;if(!b)return{...a};const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};};
export class DrawingController {
  constructor({editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard}) {
    Object.assign(this,{editor,state,overlay,viewport,onRender,onUI,onError,onStatus,beforeEdit,getResources,getTimeline,getClipboard,settings:{preset:'ink',size:8,color:'#252525',opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,sizeCurve:1,opacityCurve:1,stabilization:0,spacingRatio:.08,texture:0,resolution:2,filter:'smooth',length:1,tolerance:16,expansion:1,gap:0,sampleAll:false},sequence:0,strokeId:0,sessions:new Map(),strokeStats:{batches:0,maxQueueDepth:0,lastRoundTripMs:0}});
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
      if(kind==='document'){this.cancel();this.selection=null;this.bind();}
      if(kind==='seek'){this.finish();if(this.operation?.selection)this.operation.abort.abort();this.cancelSelection();}
      if(kind==='history'){if(!this.operation?.history)this.cancel();this.cancelSelection();}
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
    owner.onChange=()=>{if(this.selection?.presenter)this.selection.presenter.stamp++;if(this.surfaceVersion!==owner.surfaceVersion){this.surfaceVersion=owner.surfaceVersion;if(this.state.renderer){this.state.renderer.lastGeometry=null;this.state.renderer.clearArtwork?.();this.state.renderer.clearOnionArtwork?.();}}this.onRender();};owner.onError=this.onError;owner.strokeWorker.onmessage=data=>this.strokeMessage(data);owner.strokeWorker.onerror=error=>{owner.strokeWorker.dispose();this.cancel();this.onError(error);};
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
  /** Commands wait for the pixel transaction, not PNG publication. Seeking
   * may update the view meanwhile; the stroke still owns its original key. */
  settle({selection=false}={}){
    if(this.operation)return this.operation.done.then(()=>this.settle({selection}));
    if(this.loading?.done){const pending=this.loading;pending.released=true;return pending.done.then(()=>this.settle({selection}));}
    const finish=this.finish();if(finish?.then)return finish.then(()=>this.settle({selection}));const stroke=this.gesture?.session?.done;
    if(stroke)return stroke.then(()=>this.settle({selection}));
    return this.selection?.committing??(selection?this.applySelection():null);
  }
  /** One pixel transaction owns worker work and its target until publication.
   * Navigation/save barriers await it; Escape terminates it without publishing. */
  pixelOperation(label,operation,{selection=false}={}){
    if(this.operation)return this.operation.done.then(()=>this.pixelOperation(label,operation,{selection}));
    const owner=this.owner,revision=this.editor.revision,op={owner,selection,abort:new AbortController()};
    op.check=()=>{if(op.abort.signal.aborted||owner!==this.owner||revision!==this.editor.revision)throw new DOMException('Drawing operation superseded.','AbortError');};
    op.reserve=(surface,requested=TRANSFORM_BYTES,headroom=0)=>{op.check();op.copiedBytes=0;owner.hold(op,0);owner.reserve(0,surface);const s=owner.stats;op.maxBytes=Math.min(requested,Math.max(0,owner.hardBudget-s.bytes-s.historyBytes-s.deferredBytes-s.workingBytes-headroom));owner.hold(op,op.maxBytes,surface);};
    op.received=tiles=>owner.hold(op,tiles.reduce((n,t)=>n+(t.pixels?.byteLength??0)+(t.before?.byteLength??0)+(t.after?.byteLength??0)+(t.remaining?.byteLength??0),0));
    this.operation=op;owner.busy=true;this.onStatus(label+'… Escape cancels.');
    op.done=Promise.resolve().then(()=>operation(op)).then(value=>{op.succeeded=true;return value;}).finally(()=>{
      owner.hold(op,0);owner.busy=false;if(this.operation===op)this.operation=null;
      if(op.abort.signal.aborted||!op.succeeded)this.loading=null;else this.resumeQueuedPointer();
      this.onRender();
    });
    return op.done;
  }
  async copyWorkerTiles(surface,op,predicate=()=>true,{encoded=false}={}){
    const tiles=[];let copied=0;
    for(const tile of surface.store){
      if(!predicate(tile))continue;
      const field=encoded&&tile.png?.byteLength<=65536?'png':'pixels',bytes=tile[field];
      if((op.copiedBytes??0)+bytes.byteLength>op.maxBytes)throw new Error('The operation exceeds the drawing working memory limit.');
      op.copiedBytes=(op.copiedBytes??0)+bytes.byteLength;
      tiles.push({tx:tile.tx,ty:tile.ty,[field]:bytes.slice().buffer,alphaBounds:tile.alphaBounds});
      if(++copied%128===0){await yieldToInput();op.check();}
    }
    return tiles;
  }
  resumeQueuedPointer(){
    const queued=this.loading?.queued?this.loading:null;
    if(queued&&!this.gesture&&!this.operation){this.loading=null;this.run(()=>this.down({...queued.event,samples:queued.samples,released:queued.released}));}
  }
  afterGesture(operation){
    const wait=this.settle({selection:true}),report=this.editor.report;
    return wait?wait.then(()=>{if(report!==this.editor.report)throw new DOMException('Drawing document changed.','AbortError');return operation();}):operation();
  }
  history(direction){
    return this.afterGesture(()=>{
      if(!this.owner?.history?.needsLoad(this.editor[direction==='undo'?'_undo':'_redo'].at(-1)))return this.editor[direction]();
      return this.pixelOperation(direction==='undo'?'Restoring undo':'Restoring redo',async op=>{op.history=true;return this.editor[direction]({signal:op.abort.signal});});
    });
  }
  enter(){if(this.active)return;this.beforeEdit();this.prior={handles:this.state.handles,tool:this.state.tool,rotation:this.state.view.rotation??0};this.active=true;this.state.handles=false;this.state.tool='drawing-brush';this.state.drawing=true;this.cursor=null;this.bind();
    const layers=this.editor.layers.filter(layer=>isDrawingLayer(layer)&&!layer.locked&&layer.visible),target=layers.find(l=>l.id===this.editor.activeLayerId)||layers.find(l=>l.id===this.lastLayer)||layers.at(-1);if(target){this.editor.selectSheetLayer(target.id);this.state.selectedTrackId=target.id;}this.sync();this.prepareVisible();this.onUI();this.onRender();}
  exit(){if(!this.active)return;const wait=this.settle({selection:true});if(wait)return this.run(()=>wait.then(()=>this.exit()));this.active=false;this.state.drawing=false;this.cursor=null;Object.assign(this.state,{handles:this.prior.handles,tool:this.prior.tool});this.state.view.rotation=this.prior.rotation;this.onUI();this.onRender();}
  get tool(){return this.state.tool==='hand'?'pan':this.state.tool.replace('drawing-','');}
  set tool(value){this.setTool(value);}
  setTool(value){const wait=this.settle({selection:value!=='lasso'});if(wait)return this.run(()=>wait.then(()=>this.setTool(value)));
    // Brush and eraser remember their own tip, pressure and size settings.
    this.tips??={eraser:{preset:null,size:24,opacity:1,flow:1,hardness:1,pressureSize:true,pressureOpacity:false,sizeCurve:1,opacityCurve:1,stabilization:0}};
    if(['brush','eraser'].includes(this.tool))this.tips[this.tool]=Object.fromEntries(brushKeys.map(key=>[key,this.settings[key]]));
    if(this.tips[value])Object.assign(this.settings,this.tips[value]);
    this.state.tool=value==='pan'?'hand':'drawing-'+value;if(value==='transform'){try{const t=this.editor.drawingTarget();if(t.object)this.editor.select(t.object.unique_id);}catch{}}this.sync();this.onUI();this.onRender();}
  get pixelClipboard(){return this.editor._drawingPixelClipboard;}
  get exposureLabel(){try{const t=this.editor.drawingTarget();return `${t.figure?'Drawing':'Blank'} · frames ${t.key.tick+1}–${t.end}${this.editor.tick!==t.key.tick?' · editing hold':''}`;}catch{return 'No drawing exposure at this frame';}}
  sync(){if(!this.active)return;try{const t=this.editor.drawingTarget();this.exposure={layerId:t.id,start:t.key.tick,end:t.end};this.lastLayer=t.id;}catch{this.exposure=null;}this.viewport.setAttribute('aria-label','Drawing canvas. B brush, E eraser, G fill, L select pixels, V transform, H pan.');this.overlay.style.cursor=this.tool==='pan'?'grab':this.tool==='transform'?'move':'crosshair';}
  propertyValue(key){key=key.slice(5);if(key==='viewAngle')return (this.state.view.rotation??0)*180/Math.PI;if(key==='selectionScale')return (this.selection?.scale??1)*100;if(key==='selectionAngle')return this.selection?.angle??0;return this.settings[key]*(['opacity','flow','hardness','stabilization'].includes(key)?100:1);}
  propertySet(key,value){key=key.slice(5);if(key==='viewAngle')this.state.view.rotation=value*Math.PI/180;else if(key==='selectionScale'||key==='selectionAngle'){if(this.selection){this.selection[key==='selectionScale'?'scale':'angle']=key==='selectionScale'?value/100:value;this.previewSelection();}}else{this.settings[key]=value/(['opacity','flow','hardness','stabilization'].includes(key)?100:1);if(['size','opacity','flow','hardness'].includes(key))this.settings.preset=null;}this.onRender();this.paintPreview(this.panel);}
  async prepareVisible(){const owner=this.owner;if(!owner||!this.active||this.gesture)return;let target;try{target=this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const revision=this.editor.revision;try{await owner.surface(target.figure);if(owner===this.owner&&revision===this.editor.revision){this.onRender();}}catch(error){if(error.name!=='AbortError')this.onError(error);}}
  get renderPreview(){const g=this.gesture??this.selection;if(!g?.target?.created&&!g?.target?.migratedFrom)return null;if(!g.preview){const report={...this.editor.report,figure_types:[...this.editor.report.figure_types,g.target.figure],_styk:{...this.editor.report._styk,layers:{...this.editor.report._styk.layers,assignments:{...this.editor.report._styk.layers.assignments,[g.target.object.unique_id]:g.target.id}}}},frame=createFrame([...this.editor.evaluatedFrame.objects.filter(o=>o.unique_id!==g.target.object.unique_id),g.target.object]);Object.assign(frame,{camera:this.editor.evaluatedFrame.camera});for(const key of ['background_id','background_id_b','background_mix','background_color','_stykBackgroundColor'])if(key in this.editor.evaluatedFrame)frame[key]=this.editor.evaluatedFrame[key];g.preview={report,frame,geometry:buildGeometry(report,frame)};}return g.preview;}
  /** The renderer keeps the presenter even after its store is evicted:
   * presenter() kicks the re-decode, and v2 callers skip the stale data URL. */
  resource(figure){if(!drawingMetadata(figure))return null;const s=this.selection;return s&&drawingMetadata(s.target.figure)?.celId===drawingMetadata(figure).celId?s.presenter:this.owner?.presenter(figure)??null;}
  point(event){const rect=this.viewport.getBoundingClientRect();return screenToWorld({x:(event.clientX-rect.left)*this.viewport.clientWidth/rect.width,y:(event.clientY-rect.top)*this.viewport.clientHeight/rect.height},{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false});}
  geometryItem(target){let item;if(target.created||target.migratedFrom)item=buildGeometry({...this.editor.report,figure_types:[...this.editor.report.figure_types,target.figure]},createFrame([target.object])).drawables[0];else item=this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)throw new Error('The drawing pose is unavailable.');return item;}
  pixelMatrix(target){return this.gesture?.session?.target===target?this.gesture.session.pixelMatrix:drawingPixelMatrix(this.geometryItem(target));}
  pixel(event,target){return inversePoint(this.pixelMatrix(target),this.point(event));}
  async down(event){
    if(this.operation){if(!this.loading)this.loading={id:event.pointerId,sequence:++this.sequence,released:false,samples:[],event:{...pointerSample(event),pointerId:event.pointerId},queued:true};return;}
    if(this.gesture){
      // A pointer arriving while the previous stroke is closing queues behind its commit.
      if(this.gesture.kind==='stroke'&&this.gesture.session.ended&&!this.loading)this.loading={id:event.pointerId,sequence:++this.sequence,released:false,samples:[],event:{...pointerSample(event),pointerId:event.pointerId},queued:true};
      return;
    }
    if(this.loading)return;if(event.pointerType==='touch'){if(performance.now()-(this.lastPen??-Infinity)<700)return;this.overlay.setPointerCapture(event.pointerId);this.gesture={id:event.pointerId,kind:'pan',start:pointerSample(event),view:{...this.state.view}};return;}if(event.pointerType==='pen')this.lastPen=performance.now();
    this.beforeEdit();this.viewport.focus({preventScroll:true});if(!event.released)this.overlay.setPointerCapture(event.pointerId);
    const sequence=++this.sequence,revision=this.editor.revision,owner=this.owner;
    let target=this.editor.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,world:this.point(event)}),surface;
    const pending=this.loading={id:event.pointerId,sequence,released:event.released??false,samples:event.samples??[],event:pointerSample(event)};
    const current=()=>{
      const valid=this.loading===pending&&sequence===this.sequence&&revision===this.editor.revision&&owner===this.owner;
      if(!valid&&this.loading===pending){this.loading=null;if(this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);}
      return valid;
    };
    try{
      surface=await (pending.done=owner.surface(target.figure));
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
      if(this.selection&&!this.selectionContains(point))await this.applySelection();
      if(this.selection){this.gesture={id:event.pointerId,target,surface,kind:'selection-move',start:point,dx:this.selection.dx,dy:this.selection.dy};}
      else this.gesture={id:event.pointerId,target,surface,kind:'lasso',points:[point]};
    }else{
      this.cancelSelection();const color=this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16));
      const d=drawingMetadata(target.figure),size=this.settings.size*d.pixelsPerUnit,s={id:++this.strokeId,target,surface,seq:0,sent:new Set(),before:new Map(),pending:[],posted:new Map(),outstanding:0,ended:false,cancelled:false,erase:this.tool==='eraser'||event.button===5||Boolean(event.buttons&32),revision:this.editor.revision,owner:this.owner,margin:size*.55+3};
      // A stroke keeps one pose transform. Sampling must not rebuild geometry
      // for a newly created cel on every coalesced pen event.
      s.pixelMatrix=this.pixelMatrix(target);
      s.done=new Promise(resolve=>s.resolveDone=resolve);
      this.sessions.set(s.id,s);this.gesture={id:event.pointerId,target,surface,kind:'stroke',session:s};
      // Painting owns the UI thread: publication and thumbnails wait it out.
      s.owner.busy=true;
      const pixelsPerScreenUnit=1/Math.max(1e-9,Math.hypot(s.pixelMatrix[0],s.pixelMatrix[1])*(this.state.view.scale||1));
      s.margin+=Math.max(0,Math.min(.95,this.settings.stabilization))*48*Math.max(.01,Math.min(64,pixelsPerScreenUnit));
      this.owner.strokeWorker.post({kind:'begin',stroke:s.id,settings:{workingBytes:s.owner.hardBudget,size,pixelsPerUnit:pixelsPerScreenUnit,color,opacity:this.settings.opacity,flow:this.settings.flow,hardness:this.settings.hardness,pressureSize:this.settings.pressureSize,pressureOpacity:this.settings.pressureOpacity,sizeCurve:this.settings.sizeCurve,opacityCurve:this.settings.opacityCurve,stabilization:this.settings.stabilization,spacingRatio:this.settings.spacingRatio??.12,texture:this.settings.texture??0,erase:s.erase,seed:s.id}});
      this.sampleStroke(pending.event);
    }
    for(const sample of pending.samples)this.move({...sample,pointerId:event.pointerId});if(pending.released)this.finish();this.onRender();
  }
  /** Queue a pixel-space sample; one rAF-paced batch posts to the stroke worker. */
  sampleStroke(event){
    const g=this.gesture,s=g?.session;
    if(g?.kind!=='stroke'||s.ended||s.cancelled)return;
    const p=inversePoint(s.pixelMatrix,this.point(event));
    if(s.pending.length>=65536)throw new Error('Drawing input exceeded the queue limit. The stroke was cancelled; try a shorter stroke.');
    s.pending.push({x:p.x,y:p.y,pressure:event.pointerType==='pen'?event.pressure||.05:1,time:event.timeStamp});
    if(!s.raf)s.raf=requestAnimationFrame(()=>{s.raf=null;this.flushStroke(s);});
  }
  flushStroke(s){try{
    if(this.sessions.get(s.id)!==s)return;
    if(!s.pending.length){this.endStrokeWorker(s);return;}
    // Bound posted work. Keep real samples locally until an ACK frees a slot;
    // release queues its end only after the final sample batch was sent.
    if(s.outstanding>=2)return;
    const samples=s.pending.splice(0,512),points=[...(s.seedTail??[]),...samples],tiles=[];
    for(const [tx,ty] of strokeRegion(points,s.margin)){
      const key=tileKey(tx,ty);if(s.sent.has(key))continue;
      const tile=s.surface.store.get(tx,ty);if(!tile)continue;
      if(s.sent.size>=65536)throw new Error('The stroke exceeds the drawing working memory limit.');
      s.sent.add(key);tiles.push({tx,ty,pixels:tile.pixels.slice().buffer});
    }
    s.seedTail=points.slice(-2);
    const seq=++s.seq;s.outstanding++;s.posted.set(seq,performance.now());
    this.strokeStats.batches++;this.strokeStats.maxQueueDepth=Math.max(this.strokeStats.maxQueueDepth,s.outstanding);
    s.owner.strokeWorker.post({kind:'samples',stroke:s.id,seq,samples,tiles},tiles.map(t=>t.pixels).filter(Boolean));
    this.endStrokeWorker(s);
  }catch(error){this.cancel();this.onError(error);}}
  endStrokeWorker(s){if(s.ended&&!s.pending.length&&!s.endPosted){s.endPosted=true;s.owner.strokeWorker.post({kind:'end',stroke:s.id});}}
  strokeMessage(data){
    const s=this.sessions.get(data.stroke);if(!s)return;
    if(data.kind==='error'){const message=data.message;this.cancel();this.onError(new Error(message));return;}
    if(data.kind==='tiles'){
      s.outstanding=Math.max(0,s.outstanding-1);const posted=s.posted.get(data.seq);s.posted.delete(data.seq);
      if(posted!=null)this.strokeStats.lastRoundTripMs=performance.now()-posted;
      if(s.cancelled)return;
      const store=s.surface.store;
      try{
        const snapshots=[...s.before.values()].reduce((n,p)=>n+(p?.byteLength??0),0)+data.tiles.reduce((n,t)=>n+(!s.before.has(tileKey(t.tx,t.ty))?(store.get(t.tx,t.ty)?.pixels.byteLength??0):0),0);
        s.owner.hold?.(s,snapshots+data.tiles.length*TILE*TILE*4,s.surface);
        s.owner.reserve?.(s.owner.replacementBytes(s.surface,data.tiles,'pixels'),s.surface);
        for(const t of data.tiles){const key=tileKey(t.tx,t.ty);if(!s.before.has(key))s.before.set(key,store.get(t.tx,t.ty)?.pixels??null);store.set(t.tx,t.ty,new Uint8ClampedArray(t.pixels));}
        s.owner.hold?.(s,snapshots,s.surface);
      }catch(error){this.cancel();this.onError(error);return;}
      if(data.tiles.length){this.owner.present(s.surface,data.dirty);this.onRender();}
      if(s.ended)this.flushStroke(s);
      else if(s.pending.length&&!s.raf)s.raf=requestAnimationFrame(()=>{s.raf=null;this.flushStroke(s);});
      return;
    }
    if(data.kind==='done'){this.sessions.delete(s.id);this.commitStroke(s,data.changes);}
  }
  restoreStroke(s){
    const store=s.surface.store;
    for(const [key,before] of s.before){const [tx,ty]=parseTileKey(key);before?store.set(tx,ty,before):store.delete(tx,ty);}
  }
  commitStroke(s,changes){
    const g=this.gesture,valid=g?.session===s&&!s.cancelled&&s.owner===this.owner&&s.revision===this.editor.revision;
    if(g?.session===s)this.gesture=null;
    try{
      if(valid){try{this.editor.commitDrawingPixels(s.target,changes,s.erase?'Erase stroke':'Brush stroke');}catch(error){this.restoreStroke(s);this.onError(error);}}
      else this.restoreStroke(s);
    }finally{
      s.resolveDone?.();s.owner.hold?.(s,0);
      s.owner.busy=false;
      s.surface.pinned=Boolean(this.selection?.surface===s.surface);
      if(this.selection?.surface===s.surface)this.previewSelection();else{this.owner.present(s.surface);this.owner.discard(s.target.figure);}
      if(g?.session===s&&this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);
      this.sync();this.onUI();this.onRender();
      this.resumeQueuedPointer();
    }
  }
  move(event){this.cursor=pointerSample(event);if(this.loading?.id===event.pointerId){if(this.loading.samples.length>=65536)throw new Error('Drawing input exceeded the queue limit.');this.loading.samples.push(pointerSample(event));return;}const g=this.gesture;if(!g||g.id!==event.pointerId){this.onRender();return;}
    if(g.kind==='pan'){const rect=this.viewport.getBoundingClientRect();this.state.view.x=g.view.x+(event.clientX-g.start.clientX)*this.viewport.clientWidth/rect.width;this.state.view.y=g.view.y+(event.clientY-g.start.clientY)*this.viewport.clientHeight/rect.height;}
    else if(g.kind==='stroke'){if(!g.session.ended){const samples=event.getCoalescedEvents?.();for(const sample of samples?.length?samples:[event])this.sampleStroke(sample);}}
    else if(g.kind==='pose'){const p=this.point(event);this.editor.moveSelection(p.x-g.start.x,p.y-g.start.y,{fromStart:true});}
    else if(g.kind==='lasso'){const p=this.pixel(event,g.target);if(g.points.length<8192&&Math.hypot(p.x-g.points.at(-1).x,p.y-g.points.at(-1).y)>1)g.points.push(p);}
    else if(g.kind==='selection-move'){const p=this.pixel(event,g.target);this.selection.dx=g.dx+p.x-g.start.x;this.selection.dy=g.dy+p.y-g.start.y;this.previewSelection();}
    this.onRender();
  }
  up(event,cancel=false){if(this.loading?.id===event.pointerId){if(cancel){this.sequence++;this.loading=null;}else this.loading.released=true;return;}const g=this.gesture;if(!g||g.id!==event.pointerId)return;if(g.kind==='stroke'&&g.session.ended)return;return cancel?this.cancel():this.finish();}
  finish(){const g=this.gesture;
    if(g?.kind==='stroke'&&g.session.ended)return; // the done reply completes the commit
    if(this.loading)this.cancel();if(!g)return;
    if(g.kind==='pan'){this.gesture=null;if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);return;}
    if(g.kind==='stroke'){
      const s=g.session;s.ended=true;cancelAnimationFrame(s.raf);s.raf=null;
      this.flushStroke(s);
      if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);
      return; // the gesture stays closing until the worker's done arrives
    }
    this.gesture=null;try{
    if(g.kind==='pose')this.editor.commitDrag();
    else if(g.kind==='lasso')return this.run(()=>this.makeSelection(g));
  }finally{g.surface.pinned=g.kind==='lasso'&&Boolean(this.operation)||Boolean(this.selection?.surface===g.surface);if(this.selection?.surface===g.surface)this.previewSelection();else{this.owner.present(g.surface);if(!g.surface.pinned)this.owner.discard(g.target.figure);}if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.sync();this.onUI();this.onRender();}}
  cancel(){this.operation?.abort.abort();this.sequence++;const pending=this.loading;this.loading=null;if(pending&&this.overlay.hasPointerCapture(pending.id))this.overlay.releasePointerCapture(pending.id);const g=this.gesture;if(!g){this.fillAbort?.abort();return;}this.gesture=null;if(g.kind==='pan'){Object.assign(this.state.view,g.view);this.onRender();return;}if(g.kind==='stroke'){const s=g.session;s.cancelled=true;cancelAnimationFrame(s.raf);s.raf=null;this.sessions.delete(s.id);s.resolveDone?.();s.owner.hold?.(s,0);s.owner.busy=false;this.owner.strokeWorker.post({kind:'cancel',stroke:s.id});this.restoreStroke(s);}if(g.kind==='pose')this.editor.cancelDrag();if(g.kind==='selection-move')this.cancelSelection();g.surface.pinned=false;this.owner.present(g.surface);this.owner.discard(g.target.figure);this.prepareVisible();if(this.overlay.hasPointerCapture(g.id))this.overlay.releasePointerCapture(g.id);this.onRender();}
  async barrier(options){await this.settle({selection:true});if(this.loading)throw new Error('Wait for the drawing to finish loading.');await drawingBarrier(this.editor.report,options);}
  /** Fill bounds follow the document, independent of display zoom. */
  fillBounds(target,store){
    const matrix=this.pixelMatrix(target),toPixel=p=>inversePoint(matrix,p);
    const report=this.editor.report,stage=[[0,0],[report.canvas_width,0],[report.canvas_width,report.canvas_height],[0,report.canvas_height]].map(([x,y])=>toPixel({x,y}));
    const box=points=>({x:Math.floor(Math.min(...points.map(p=>p.x))),y:Math.floor(Math.min(...points.map(p=>p.y))),width:Math.ceil(Math.max(...points.map(p=>p.x)))-Math.floor(Math.min(...points.map(p=>p.x))),height:Math.ceil(Math.max(...points.map(p=>p.y)))-Math.floor(Math.min(...points.map(p=>p.y)))});
    return unionRects(box(stage),store.bounds);
  }
  fill(target,surface,point){return this.pixelOperation('Filling drawing',async op=>{
    const controller=this.fillAbort=op.abort,owner=op.owner;surface.pinned=true;
    try{
      op.reserve(surface,owner.hardBudget);
      const bounds=this.fillBounds(target,surface.store);
      if(!bounds)return;if(bounds.width*bounds.height>64*1024*1024)throw new Error('The fill region exceeds 64 megapixels.');
      let source;
      if(this.settings.sampleAll){await this.barrierForComposite();op.check();const c=canvas(bounds.width,bounds.height),ctx=c.getContext('2d'),inverse=new DOMMatrix(this.pixelMatrix(target)).inverse();ctx.setTransform(inverse.a,inverse.b,inverse.c,inverse.d,inverse.e-bounds.x,inverse.f-bounds.y);drawGeometry(ctx,{drawables:this.editor.geometry.drawables.filter(i=>this.editor.getLayer(this.editor.layerForUid(i.obj.unique_id))?.visible!==false)},this.getResources());source=ctx.getImageData(0,0,c.width,c.height).data.buffer;c.width=c.height=1;}
      const tiles=await this.copyWorkerTiles(surface,op,t=>tileIntersects(t,bounds));
      const result=await owner.worker.request('fill',{bounds,tiles,options:{maxBytes:op.maxBytes,...point,color:[...this.settings.color.slice(1).match(/../g).map(n=>parseInt(n,16)),Math.round(this.settings.opacity*255)],tolerance:this.settings.tolerance,expansion:this.settings.expansion,gap:this.settings.gap},source},{signal:controller.signal,transfer:[...tiles.map(t=>t.pixels),...(source?[source]:[])]});
      op.check();op.received(result.tiles);this.editor.commitDrawingPixels(target,result.tiles,'Fill drawing');this.onStatus('Drawing filled.');
    }finally{surface.pinned=false;owner.discard(target.figure);if(this.fillAbort===controller)this.fillAbort=null;}
  });}
  async barrierForComposite(){await drawingBarrier(this.editor.report);const assets=this.editor.geometry.drawables.filter(i=>i.type==='image');await Promise.all(assets.map(async i=>{const image=this.getResources().image(this.getResources().url(i.asset));if(image&&!image.complete)await image.decode?.();}));}
  makeSelection(g){
    const bounds=lassoBounds(g.points);if(!bounds)return;this.cancelSelection();
    const xs=g.points.map(p=>p.x),ys=g.points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    return this.pixelOperation('Selecting pixels',async op=>{
      const owner=op.owner;g.surface.pinned=true;
      try{
        op.reserve(g.surface);const tiles=await this.copyWorkerTiles(g.surface,op,t=>tileIntersects(t,bounds));
        const result=await owner.worker.request('select',{tiles,points:g.points,maxBytes:op.maxBytes},{signal:op.abort.signal,transfer:tiles.map(t=>t.pixels)});
        op.check();op.received(result.tiles);
        const stores=selectionStores(g.surface.store,result.tiles),s={...stores,cx,cy,target:g.target,surface:g.surface,bounds,points:g.points,dx:0,dy:0,scale:1,angle:0,filter:this.settings.filter};
        s.presenter=selectionPresenter(s,owner);this.selection=s;owner.hold(op,0);owner.surfaceVersion++;owner.onChange();this.previewSelection();this.onUI();this.onStatus('Pixels selected.');
      }finally{g.surface.pinned=this.selection?.surface===g.surface;if(!g.surface.pinned)owner.discard(g.target.figure);}
    },{selection:true});
  }
  previewSelection(){const s=this.selection;if(!s||s.committing)return;s.presenter.stamp++;this.onRender();}
  commitSelection(s,label,{remove=false,operation}={}){
    if(s.committing)return s.committing;
    const commit=async op=>{
      if(this.selection!==s)throw new DOMException('Selection changed.','AbortError');
      const owner=op.owner,abort=s.abort=op.abort;op.reserve(s.surface);
      const matrix=selectionMatrix(s),selected=new Set(selectionTiles(s.surface.store,s.source,matrix,this.settings.filter,{remove,maxBytes:op.maxBytes}));
      const tiles=await this.copyWorkerTiles(s.surface,op,t=>selected.has(t));
      const source=await this.copyWorkerTiles({store:s.source},op);
      const result=await owner.worker.request('selection',{tiles,selection:{matrix,tiles:source,remove,filter:this.settings.filter,maxBytes:op.maxBytes}},{signal:abort.signal,transfer:[...source.map(t=>t.pixels),...tiles.map(t=>t.pixels)]});
      op.check();if(this.selection!==s)throw new DOMException('Selection changed.','AbortError');op.received(result.tiles);
      // The selection buffers remain live until the cel replacement finishes;
      // keep them in the owner's budget while it reserves the committed tiles.
      const changed=this.editor.commitDrawingPixels(s.target,result.tiles,label);this.endSelection(false);return changed;
    };
    s.committing=(operation?commit(operation):this.pixelOperation(label,commit)).finally(()=>{if(this.selection===s)this.endSelection(false);this.onRender();});
    return s.committing;
  }
  selectionContains(point){const s=this.selection;if(!s)return false;const angle=-s.angle*Math.PI/180,x=point.x-s.cx-s.dx,y=point.y-s.cy-s.dy,px=Math.floor(s.cx+(Math.cos(angle)*x-Math.sin(angle)*y)/s.scale),py=Math.floor(s.cy+(Math.sin(angle)*x+Math.cos(angle)*y)/s.scale);return lassoContains(s.points,px,py);}
  applySelection(){const s=this.selection;if(!s)return;if(s.committing)return s.committing;if(!s.dx&&!s.dy&&s.scale===1&&!s.angle){this.cancelSelection();return;}return this.commitSelection(s,'Transform selected pixels');}
  endSelection(cancel=true){const s=this.selection;if(!s)return;this.selection=null;if(cancel)s.abort?.abort();s.presenter?.dispose();s.surface.pinned=false;this.owner.surfaceVersion++;this.owner.present(s.surface);this.onRender();}
  cancelSelection(){this.endSelection(true);}
  async action(action){if(action==='cancel-selection')return this.cancelSelection();const pending=this.settle();if(pending)await pending;const e=this.editor,ids=[e.activeLayerId];
    if(action==='new'){const layer=e.createDrawingLayer();this.state.selectedTrackId=layer.id;this.getTimeline()?.selectTrack?.(layer.id);this.sync();this.onUI();return;}
    if(!['copy-pixels','cut-pixels','delete-pixels','apply-selection','cancel-selection'].includes(action))await this.applySelection();
    if(action==='blank')return e.drawingKey(ids,e.tick,{blank:true});if(action==='copy-key'){if(!e.drawingKey(ids))this.onStatus('This cell already starts a drawing. Use Next copy to add time.');return;}
    if(action==='extend')return e.extendDrawing(ids,this.settings.length);if(action==='next-blank'||action==='next-copy')return e.nextDrawing(ids,{blank:action==='next-blank',length:this.settings.length});
    if(action==='apply-selection')return this.applySelection();if(action==='cancel-selection')return this.cancelSelection();if(action==='retry')return this.barrier();
    if(action==='reset-rotation'){this.state.view.rotation=0;this.onRender();return;}
    if(action==='delete-pixels'){const s=this.selection;if(!s)return;return this.commitSelection(s,'Delete selected pixels',{remove:true});}
    if(action==='duplicate-layer'){await this.barrier();const source=e.getLayer(e.activeLayerId),end=e.report._styk.layerSheet.tracks[source.id].end;const old=e._sheetClipboard;try{e.sheetCopyFrames([source.id],0,end-1);return e.movieclipBatch('Duplicate drawing layer',()=>{const layer=e.createLayer(source.name+' copy',{drawing:true});e.sheetPasteFrames([layer.id],0);});}finally{e._sheetClipboard=old;}}
    if(['copy-pixels','cut-pixels'].includes(action))return this.pixelOperation('Copying pixels',async op=>{
      const s=this.selection;if(!s)throw new Error('Select pixels with the lasso first.');
      await this.getClipboard().copy('drawing-pixels',async()=>{
        op.reserve(s.surface,op.owner.hardBudget,op.owner.scratchBudget);
        const tiles=await this.copyWorkerTiles({store:s.source},op,()=>true,{encoded:true});
        const result=await op.owner.worker.request('copy-selection',{tiles,maxBytes:op.maxBytes},{signal:op.abort.signal,transfer:tiles.map(t=>t.png??t.pixels)});
        op.check();if(this.selection!==s)throw new DOMException('The selection changed. Copy it again.','AbortError');
        // Encoding is finished; retain only the packet/transfer working set
        // while the native clipboard acknowledges its bounded chunks.
        op.owner.hold(op,result.tiles.reduce((n,t)=>n+t.png.length*4+128,0)+128*1024,s.surface);
        const bounds=s.source.bounds,matrix=multiplyMatrix(this.pixelMatrix(s.target),selectionMatrix(s)),world=transformPoint(matrix,bounds??s.bounds);
        const clip={version:2,pixelsPerUnit:drawingMetadata(s.target.figure).pixelsPerUnit,bounds,tiles:result.tiles,world,matrix};validatePixelClipboard(clip);e._drawingPixelClipboard=clip;return true;
      },{signal:op.abort.signal,checkCurrent:op.check});
      op.check();if(action==='cut-pixels')await this.commitSelection(s,'Cut selected pixels',{remove:true,operation:op});
      return true;
    });
    if(action==='paste-pixels')return this.pixelOperation('Pasting pixels',op=>this.getClipboard().paste('drawing-pixels',async()=>{
      const clip=e._drawingPixelClipboard;if(!clip)throw new Error('Copy selected pixels first.');validatePixelClipboard(clip);this.cancelSelection();if(clip.version===2&&!clip.tiles.length)return false;
      const owner=op.owner;
      let target=e.prepareDrawingCel({pixelsPerUnit:this.settings.resolution,world:clip.world}),surface;
      try{
        surface=await owner.surface(target.figure);op.check();surface.pinned=true;op.reserve(surface,owner.hardBudget,owner.scratchBudget);
        const d=drawingMetadata(target.figure);
        if(d.version===1){const figure=migrateDrawingFigure(target.figure,e.report.figure_types.reduce((n,f)=>Math.max(n,f.figure_type_id+1),1),{bounds:surface.store.bounds});owner.retarget(d.celId,figure);target={...target,figure,object:{...structuredClone(target.object),figure_type_id:figure.figure_type_id},migratedFrom:d.celId};}
        const sourceMatrix=clip.matrix??[1/clip.pixelsPerUnit,0,0,1/clip.pixelsPerUnit,clip.world?.x??0,clip.world?.y??0];
        const matrix=multiplyMatrix(inverseMatrix(this.pixelMatrix(target)),sourceMatrix).map(n=>Math.abs(n-Math.round(n))<1e-9?Math.round(n):n);
        const coverage=clip.version===2?indexedTileCoverage(clip.tiles,matrix,this.settings.filter,op.maxBytes):null;
        const bounds=coverage?null:transformSupportBounds({x:0,y:0,width:clip.width,height:clip.height},matrix,this.settings.filter);
        const tiles=await this.copyWorkerTiles(surface,op,t=>coverage?coverage.has(tileKey(t.tx,t.ty)):tileIntersects(t,bounds));
        const result=await owner.worker.request('paste',{tiles,clip,matrix,filter:this.settings.filter,maxBytes:op.maxBytes},{signal:op.abort.signal,transfer:tiles.map(t=>t.pixels)});
        op.check();op.received(result.tiles);return e.commitDrawingPixels(target,result.tiles,'Paste selected pixels');
      }finally{if(surface){surface.pinned=false;owner.present(surface);}owner.discard(target.figure);}
    },{signal:op.abort.signal,checkCurrent:op.check}));
    if(action==='resample'){
      const target=e.drawingTarget();if(!target.figure)throw new Error('Paint a drawing before resampling it.');
      const resolution=this.settings.resolution,d=drawingMetadata(target.figure),ratio=resolution/d.pixelsPerUnit;
      if(ratio===1){this.onStatus('This drawing already uses the chosen resolution.');return;}
      await this.barrier();
      return this.pixelOperation('Resampling drawing',async op=>{
        const surface=await op.owner.surface(target.figure);op.check();surface.pinned=true;
        try{
          op.reserve(surface);const tiles=await this.copyWorkerTiles(surface,op);
          const result=await op.owner.worker.request('resample',{tiles,ratio,filter:this.settings.filter,maxBytes:op.maxBytes},{signal:op.abort.signal,transfer:tiles.map(t=>t.pixels)});
          op.check();op.received(result.tiles);e.resampleDrawing(target,{pixelsPerUnit:resolution,tiles:result.tiles,bounds:result.bounds});
          this.onStatus('Drawing resampled. Undo restores its original pixels.');
        }finally{surface.pinned=false;}
      });
    }
  }

  change(event){this.finish();const input=event.target,name=input.dataset.drawSetting;if(!name)return;this.settings[name]=input.type==='checkbox'?input.checked:input.type==='color'||name==='filter'?input.value:Number(input.value);if(name==='filter'&&this.selection){this.selection.filter=this.settings.filter;this.previewSelection();}this.sync();this.onUI();}
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
      const stroke=new DrawingStroke(store,{size:px,color,opacity:s.opacity,flow:s.flow,hardness:s.hardness,pressureSize:s.pressureSize,pressureOpacity:s.pressureOpacity,sizeCurve:s.sizeCurve,opacityCurve:s.opacityCurve,stabilization:s.stabilization,spacingRatio:s.spacingRatio??.12,texture:s.texture??0,erase,seed:1,pixelsPerUnit:ppu});
      const n=40;
      for(let i=0;i<n;i++){const t=i/(n-1);stroke.sample({x:pad+span*t,y:mid+Math.sin(t*Math.PI*2)*amp,pressure:.15+.85*Math.sin(Math.PI*t),time:i});}
      stroke.finish();
      const bounds=store.bounds;if(!bounds)return;
      const ctx=preview.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.putImageData(new ImageData(store.readRect(bounds.x,bounds.y,bounds.width,bounds.height),bounds.width,bounds.height),bounds.x,bounds.y);
    }catch{}
  }
  overlayDraw(ctx){if(!this.active)return;let target;try{target=this.gesture?.target??this.editor.drawingTarget();}catch{return;}if(!target.figure)return;const g=this.gesture,item=this.renderPreview?.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id)??this.editor.geometry.drawables.find(i=>i.obj.unique_id===target.object.unique_id&&i.type==='image');if(!item)return;const matrix=drawingPixelMatrix(item),screen=p=>worldToScreen(transformPoint(matrix,p),{report:this.editor.report,frame:this.editor.evaluatedFrame,view:this.state.view,cameraEnabled:false}),d=drawingMetadata(target.figure);ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;const points=g?.kind==='lasso'?g.points:this.selection?.points;if(points?.length){ctx.strokeStyle='#2878ed';ctx.beginPath();points.forEach((p,i)=>{const s=this.selection,angle=(s?.angle??0)*Math.PI/180,x=s?(p.x-s.cx)*s.scale:p.x,y=s?(p.y-s.cy)*s.scale:p.y,q=screen(s?{x:s.cx+s.dx+Math.cos(angle)*x-Math.sin(angle)*y,y:s.cy+s.dy+Math.sin(angle)*x+Math.cos(angle)*y}:p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();}if(this.cursor&&this.gesture?.kind!=='pan'&&this.state.drag?.kind!=='pan'&&['brush','eraser'].includes(this.tool)){const p=this.pixel(this.cursor,target),center=screen(p),edge=screen({x:p.x+this.settings.size*d.pixelsPerUnit/2,y:p.y}),radius=Math.hypot(edge.x-center.x,edge.y-center.y);ctx.setLineDash([]);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(center.x,center.y,Math.max(1,radius),0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.stroke();}ctx.restore();}
  destroy(){this.cancel();this.cancelSelection();this.events.abort();this.owner?.dispose();}
}
