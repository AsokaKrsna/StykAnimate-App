import {DrawingPreviewCache} from './drawing-preview-cache.mjs';
import {DrawingHistory} from './drawing-history.mjs';
import {DrawingTileMemory} from './drawing-tile-memory.mjs';
import {historyPixelBytes} from './drawing-history-codec.mjs';
import {drawingMetadata,EMPTY_PNG} from './drawing-model.mjs';
import {TileStore,TILE,TILE_BYTES,tileKey,tileTransparent} from './drawing-tiles.mjs';
import {applyTileChanges} from './drawing-pixels.mjs';
import {tileStoreFromList} from './drawing-tile-codec.mjs';
import {presenterScratch,retainedPresenterScratch,levelStore,invalidateLevels} from './drawing-raster.mjs';
import {prepareDrawingChanges,needsDrawingPreparation,validateDrawingChanges} from './drawing-preparation.mjs';

const owners=new WeakMap(),clipboardPixels=new WeakMap();
export const drawingClipboardPixels=clipboard=>clipboardPixels.get(clipboard);
export const drawingResourcesFor=report=>owners.get(report);
export async function drawingBarrier(report,options={}) {
  await owners.get(report)?.flush(options);
  const seen=options.seen??new Set();if(seen.has(report))return;seen.add(report);
  for(let i=0;i<(report.figure_types?.length??0);i++){const figure=report.figure_types[i];if(figure._styk?.movieclip?.document)await drawingBarrier(figure._styk.movieclip.document,{...options,seen});}
  if(report._styk?.movieclipSource?.document)await drawingBarrier(report._styk.movieclipSource.document,{...options,seen});
}
class DrawingWorker {
  constructor(url=new URL('./drawing-worker.mjs',import.meta.url)){this.url=url;this.next=1;this.pending=new Map();}
  request(kind,payload,{signal,transfer}={}) {
    if(signal?.aborted)return Promise.reject(new DOMException('Drawing operation cancelled.','AbortError'));
    if(this.pending.size>=2)return Promise.reject(new Error('Drawing worker is busy. Wait for the current operation.'));
    if(!this.worker){
      this.worker=new Worker(this.url,{type:'module',name:'StykAnimate drawing pixels'});
      this.worker.onmessage=({data})=>{const pending=this.pending.get(data.id);if(!pending){data.bitmap?.close();return;}if(data.fatal){this.dispose(new Error(data.error||'Drawing worker could not load. Retry the operation.'));return;}this.pending.delete(data.id);pending.finish(data.error?new Error(data.error):null,data);};
      this.worker.onerror=e=>{e.preventDefault();this.dispose(new Error(e.message||'Drawing worker stopped. Retry the operation.'));};
      this.worker.onmessageerror=()=>this.dispose(new Error('Drawing pixels could not be transferred.'));
    }
    return new Promise((resolve,reject)=>{
      const id=this.next++,abort=()=>this.dispose(new DOMException('Drawing operation cancelled.','AbortError'));
      const timeout=setTimeout(()=>this.dispose(new Error('Drawing worker timed out. Retry the operation.')),120000);
      this.pending.set(id,{finish:(error,result)=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);}});
      signal?.addEventListener('abort',abort,{once:true});
      this.worker.postMessage({id,kind,...payload},transfer??[]);
    });
  }
  dispose(error=new DOMException('Drawing resources closed.','AbortError')){this.worker?.terminate();this.worker=null;for(const p of this.pending.values())p.finish(error);this.pending.clear();}
}

/** Persistent stroke worker handle: one per DrawingResources so a heavy encode
 * or fill on the pixel worker never blocks painting. The Worker is spawned
 * lazily so this stays safe in non-DOM contexts. */
export class StrokeWorker {
  open(){if(!this.worker){this.worker=new Worker(new URL('./drawing-stroke-worker.mjs',import.meta.url),{type:'module',name:'StykAnimate drawing stroke'});this.worker.onmessage=({data})=>this.onmessage?.(data);this.worker.onerror=event=>{event.preventDefault();this.onerror?.(new Error(event.message||'Drawing stroke worker stopped.'));};this.worker.onmessageerror=()=>this.onerror?.(new Error('Stroke pixels could not be transferred.'));}}
  post(message,transfer){if(this.closed)return;this.open();this.worker.postMessage(message,transfer??[]);}
  // dispose() stays respawnable for crash recovery; close() is permanent.
  dispose(){this.worker?.terminate();this.worker=null;}
  close(){this.closed=true;this.dispose();}
}

const sideBytes=s=>s==null?0:s.byteLength===4?TILE_BYTES:s.byteLength;
const PUBLICATION_BATCH_BYTES=1024*1024;

/** The tile store is the single authoritative raster. Publications are derived:
 * the per-tile PNG blob on image_assets[0].styk_tiles plus a bounds-sized
 * preview PNG on data_url keep legacy asset consumers working. */
export class DrawingResources {
  constructor(report,{tileBytes=192*1024*1024,levelBytes=64*1024*1024,scratchBytes=64*1024*1024,hardBytes,onChange=()=>{},onError=()=>{},worker,strokeWorker,history}={}) {
    // tileBudget is the retention target; hardBudget is the only point a
    // required working set is refused. Between them, required dirty/pinned
    // tiles stay resident while publication frees them in the background.
    Object.assign(this,{report,tileBudget:tileBytes,hardBudget:hardBytes??tileBytes*4,levelBudget:levelBytes,scratchBudget:scratchBytes,onChange,onError,entries:new Map(),transients:new Set(),worker:worker??new DrawingWorker(),decodeWorker:worker??new DrawingWorker(),strokeWorker:strokeWorker??new StrokeWorker(),generation:1,surfaceVersion:0,decodeQueue:[],thumbnailQueue:new Map(),thumbnailCache:new Map(),thumbnailWorker:worker??new DrawingWorker(),decodes:0,lastEncode:null});owners.set(report,this);
    this.pixelMemory=new DrawingTileMemory();
    this.compositeWorker=worker??new DrawingWorker(new URL('./drawing-composite-worker.mjs',import.meta.url));
    if(typeof Worker!=='undefined')this.previews=new DrawingPreviewCache(new DrawingWorker(),{budgetBytes:scratchBytes,onReady:()=>this.onChange(),onError,reserve:bytes=>this.scratchReserved(null,bytes),hold:(job,bytes)=>this.hold(job,bytes,job.entry)});
    this.history=history===false?null:history??(typeof Worker!=='undefined'&&typeof indexedDB!=='undefined'?new DrawingHistory({reserve:bytes=>this.reserve(bytes),hold:bytes=>this.hold(this.history,bytes),onWarning:error=>this.onError(error)}):null);
  }
  /** While a stroke session or scrub owns the UI thread, the publication
   * debounce and the thumbnail pump wait; clearing busy re-arms both. */
  set busy(value){value=Boolean(value);if(this._busy===value)return;this._busy=value;if(!value){this.schedule();this.pumpThumbnail();}}
  get busy(){return Boolean(this._busy);}
  entry(figure) {
    const d=drawingMetadata(figure);let entry=this.entries.get(d.celId);
    if(!entry){entry={id:d.celId,store:null,revision:d.revision,published:null,loading:null,decodeError:null,pinned:false,used:performance.now(),stamp:0,deferred:[],levels:null,levelsUsed:0,owner:this};this.entries.set(d.celId,entry);}else this.restorePublication(entry,figure);return entry;
  }
  /** History replaces figure snapshots, but a cel's last encoded revision is
   * owned here. Reattach it to restored definitions before decoding/saving. */
  restorePublication(entry,figure){
    const published=entry.published,d=drawingMetadata(figure);
    if(d?.version!==2||published?.revision!==entry.revision)return;
    const asset=figure.image_assets[0];
    if(published.url)asset.styk_tiles=published.url;else delete asset.styk_tiles;
    asset.data_url=EMPTY_PNG;asset.width=asset.height=asset.display_width=asset.display_height=1;
    d.revision=entry.revision;
    const bounds=Object.hasOwn(published,'bounds')?published.bounds:d.bounds;d.bounds=bounds?{...bounds}:null;
  }
  /** Resident tile bytes dedupe by pixel buffer: copy-on-write forks share
   * tiles, so shared tiles count once, not once per entry. */
  *surfaces(){yield* this.entries.values();yield* this.transients;}
  residentMemory(){return this.pixelMemory.sync(this.surfaces());}
  residentPixels(){return new Set(this.residentMemory().references.keys());}
  get stats(){let tiles=0,levelBytes=0,scratchBytes=0,unpublished=0,deferredBytes=0;const deferred=new Set();for(const e of this.surfaces()){if(e.store)tiles+=e.store.size;for(const step of e.deferred??[])if(!deferred.has(step.changes)&&!this.history?.owns(step.changes)){deferred.add(step.changes);deferredBytes+=historyPixelBytes(step.changes);}for(const level of e.levels??[])levelBytes+=level?.bytes??0;for(const s of e._scratches?.values()??[])if(s.canvas)scratchBytes+=s.canvas.width*s.canvas.height*4;if(!e.transient&&(e.store||e.deferred?.length)&&e.published?.revision!==e.revision)unpublished++;}return {tiles,bytes:this.residentMemory().bytes,historyBytes:this.history?.residentBytes??0,deferredBytes,workingBytes:this.workingBytes,levelBytes,scratchBytes:scratchBytes+(this.previews?.bytes??0),entries:this.entries.size,transients:this.transients.size,unpublished,inFlight:this.encoding?1:0,workers:[this.worker,this.decodeWorker,this.thumbnailWorker,this.strokeWorker,this.previews?.worker,this.history?.disk].filter(w=>w?.worker).length,decodes:this.decodes,lastEncode:this.lastEncode};}
  dropScratch(e){this.previews?.drop(e);const map=e._scratches;if(!map)return;for(const s of map.values())if(s.canvas)s.canvas.width=s.canvas.height=1;e._scratches=null;}
  /** Rebuildable presenter scratch canvases yield to newer work first. */
  scratchReserved(entry,requested=0,keep=null){
    let bytes=this.previews?.bytes??0;const candidates=[];
    for(const e of this.surfaces())for(const [key,s] of e._scratches??[])if(s.canvas){bytes+=s.canvas.width*s.canvas.height*4;if(s!==keep&&!s.pinned)candidates.push({e,key,s});}
    if(bytes+requested<=this.scratchBudget)return true;
    for(const {e,key,s} of candidates.sort((a,b)=>a.e.used-b.e.used||a.s.used-b.s.used)){if(bytes+requested<=this.scratchBudget)break;bytes-=s.canvas.width*s.canvas.height*4;s.canvas.width=s.canvas.height=1;e._scratches.delete(key);if(!e._scratches.size)e._scratches=null;}
    for(const [key,value] of this.previews?.cache??[]){if(bytes+requested<=this.scratchBudget)break;bytes-=value.bytes;this.previews.remove(key);}
    return bytes+requested<=this.scratchBudget;
  }
  /** Derived mip chains are the cheapest cache: evict least-recently-used first. */
  levelsReserved(entry){entry.levelsUsed=performance.now();let bytes=0;for(const e of this.surfaces())for(const level of e.levels??[])bytes+=level?.bytes??0;if(bytes<=this.levelBudget)return;for(const e of [...this.surfaces()].sort((a,b)=>a.levelsUsed-b.levelsUsed)){if(bytes<=this.levelBudget)break;if(e===entry||!e.levels)continue;bytes-=e.levels.reduce((n,l)=>n+(l?.bytes??0),0);e.levels=null;e.levelKnown=null;}}
  reserve(bytes,except) {
    if(!Number.isFinite(bytes)||bytes<0)throw new Error('Invalid drawing memory reservation.');
    const resident=()=>{const s=this.stats;return s.bytes+s.historyBytes+s.deferredBytes+s.workingBytes;},target=Math.min(this.tileBudget,this.hardBudget);
    if(resident()+bytes<=target)return;
    this.history?.trim(0);
    // Rebuildable memory frees before authoritative tiles: presenter
    // scratches, then derived mip levels, then published-and-clean stores.
    for(const e of this.surfaces())if(e!==except&&![...e._scratches?.values()??[]].some(s=>s.pinned))this.dropScratch(e);
    for(const e of this.surfaces())if(e!==except){e.levels=null;e.levelKnown=null;}
    for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){
      if(resident()+bytes<=target)break;
      if(e===except||e.pinned||e.preparing||!e.store||e.published?.revision!==e.revision)continue;e.store=null;e.levels=null;e.levelKnown=null;this.surfaceVersion++;
    }
    if(resident()+bytes<=target)return;
    // Everything left is dirty or pinned work that must not be lost. Kick the
    // publication pump so those stores become evictable, and hold the required
    // set above the soft budget rather than rejecting the edit.
    this.flush().catch(this.onError);
    if(resident()+bytes>this.hardBudget)throw new Error('Drawing memory is full. Choose 1× resolution or finish the current edit.');
  }
  get workingBytes(){let n=0;for(const bytes of this.working?.values()??[])n+=bytes;return n;}
  hold(key,bytes,entry){this.working??=new Map();const old=this.working.get(key)??0;if(bytes>old)this.reserve(bytes-old,entry);if(bytes)this.working.set(key,bytes);else this.working.delete(key);}
  /** Replacing a shared buffer keeps its old bytes alive in another cel. */
  replacementBytes(entry,changes,direction){
    const references=this.residentMemory().references,removed=new Map();let bytes=0;
    for(const c of changes){bytes+=sideBytes(c[direction]);const old=entry.store?.get(c.tx,c.ty)?.pixels;if(old)removed.set(old,(removed.get(old)??0)+1);}
    for(const [pixels,count] of removed)if(references.get(pixels)<=count)bytes-=pixels.byteLength;
    return Math.max(0,bytes);
  }
  /** Move an in-flight or resident entry under a new cel id (lazy migration). */
  retarget(oldCelId,figure){const e=this.entries.get(oldCelId),d=drawingMetadata(figure);if(!e||!d||d.celId===oldCelId)return;this.entries.delete(oldCelId);e.id=d.celId;this.entries.set(e.id,e);}
  /** Install decoded/resampled tiles under a figure's cel (publication follows). */
  install(figure,tiles,{owned=false}={}){
    this.reserve((tiles?.length??0)*TILE_BYTES,this.entries.get(drawingMetadata(figure).celId));
    const e=this.entry(figure),store=new TileStore();
    for(const t of tiles??[]){const pixels=owned&&t.pixels instanceof Uint8ClampedArray?t.pixels:new Uint8ClampedArray(t.pixels);if(owned)store.adopt(t.tx,t.ty,pixels,t.alphaBounds);else store.set(t.tx,t.ty,pixels);}
    e.store=store;e.deferred=[];e.published=null;e.revision=drawingMetadata(figure).revision;e.stamp++;e.decodeError=null;e.levels=null;e.levelKnown=null;this.dropScratch(e);this.surfaceVersion++;this.residentMemory();this.onChange();this.schedule();return e;
  }
  discard(figure){const id=drawingMetadata(figure)?.celId,e=this.entries.get(id);if(!e||this.report.figure_types.some(f=>drawingMetadata(f)?.celId===id))return;e.disposed=true;this.dropScratch(e);e.store=null;e.levels=null;e.levelKnown=null;this.entries.delete(id);this.residentMemory();this.surfaceVersion++;this.onChange();}
  async surface(figure) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    const e=this.entry(figure);e.used=performance.now();
    if(e.store)return e;
    if(e.loading)return e.loading;
    const generation=this.generation,base=e.revision-(e.deferred?.length??0);
    e.loading=(async()=>{
      const d=drawingMetadata(figure);
      // Deferred history starts at the owner's published base, even if an
      // asset-only undo/redo restored an older definition snapshot.
      const live=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===d.celId)??figure,asset=live.image_assets[0];
      const url=e.published?e.published.url:asset.styk_tiles;
      const result=await this.decode(e,()=>d.version===1?this.decodeWorker.request('decode-legacy',{url:asset.data_url,crop:d.crop}):url?this.decodeWorker.request('decode-tiles',{url}):Promise.resolve({tiles:[]}));
      if(this.disposed||generation!==this.generation)throw new DOMException('Drawing changed.','AbortError');
      const store=tileStoreFromList(result.tiles);
      for(const step of e.deferred)applyTileChanges(store,step.changes,step.direction);
      e.deferred=[];this.reserve(store.bytes,e);e.store=store;e.stamp++;e.decodeError=null;e.levels=null;e.levelKnown=null;this.dropScratch(e);this.surfaceVersion++;
      e.published??={revision:base,url:d.version===2?asset.styk_tiles??null:null,bounds:d.bounds?{...d.bounds}:null};
      this.residentMemory();this.onChange();return e;
    })().finally(()=>{e.loading=null;});return e.loading;
  }
  decode(e,request){
    return new Promise((resolve,reject)=>{
      if(this.disposed){reject(new DOMException('Drawing document closed.','AbortError'));return;}
      if(this.decodeQueue.length>=2)this.decodeQueue.shift().reject(new DOMException('A newer drawing was requested.','AbortError'));
      this.decodeQueue.push({e,request,resolve,reject});this.pumpDecode();
    });
  }
  pumpDecode(){
    if(this.decoding||this.disposed||!this.decodeQueue.length)return;
    const job=this.decodeQueue.shift();this.decoding=true;this.decodes++;job.e.decodes=(job.e.decodes??0)+1;
    job.request().then(job.resolve,job.reject).finally(()=>{this.decoding=false;this.pumpDecode();});
  }
  thumbnail(figure,onReady){
    if(this.disposed)return null;
    const d=drawingMetadata(figure),e=this.entries.get(d.celId),version=e?.revision??d.revision,hit=this.thumbnailCache.get(d.celId);
    if(hit?.version===version)return hit.canvas;
    if(!this.thumbnailQueue.has(d.celId)&&this.thumbnailActive!==d.celId){
      if(this.thumbnailQueue.size>=48)this.thumbnailQueue.delete(this.thumbnailQueue.keys().next().value);
      this.thumbnailQueue.set(d.celId,{figure,onReady,version});this.pumpThumbnail();
    }
    return hit?.canvas;
  }
  pumpThumbnail(){
    if(this.thumbnailActive||this.disposed||this._busy||!this.thumbnailQueue.size)return;
    const [id,job]=this.thumbnailQueue.entries().next().value;this.thumbnailQueue.delete(id);this.thumbnailActive=id;
    const d=drawingMetadata(job.figure),e=this.entries.get(id),asset=job.figure.image_assets[0];
    // Resident stores rasterize from the smallest mip still spanning ~64 px;
    // blob/legacy payloads mip inside the worker after decoding.
    let payload;
    if(e?.store){
      // CPU downsampling is owned by the thumbnail worker too.
      payload={tiles:[...e.store].map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}))};
    }else payload=d.version===1?{legacy:{url:asset.data_url,crop:d.crop}}:asset.styk_tiles?{url:asset.styk_tiles}:{bounds:null,tiles:[]};
    const transfers=payload.tiles?.map(t=>t.pixels)??[];
    this.thumbnailWorker.request('thumbnail',payload,{transfer:transfers}).then(result=>{
      if(this.disposed)return;const c=document.createElement('canvas');c.width=result.width;c.height=result.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels),c.width,c.height),0,0);
      this.thumbnailCache.get(id)?.canvas.remove();this.thumbnailCache.set(id,{version:job.version,canvas:c});while(this.thumbnailCache.size>256){const [old,entry]=this.thumbnailCache.entries().next().value;entry.canvas.width=entry.canvas.height=1;this.thumbnailCache.delete(old);}job.onReady?.();
    },error=>{if(error.name!=='AbortError')this.onError(error);}).finally(()=>{this.thumbnailActive=null;this.pumpThumbnail();});
  }
  /** The renderer-facing presenter: the live store plus scratch and mip
   * rasterizers. Levels are entry-owned caches rebuilt lazily and evicted
   * first under memory pressure. */
  rasterPresenter(e){
    e.used=performance.now();e.scratch??=(rect,options)=>this.previews&&e.store?.size>64?(this.previews.scratch(e,rect,options)??retainedPresenterScratch(e,rect,options)):presenterScratch(e,rect,options);e.level??=(k,rect)=>{e.levelsUsed=performance.now();return levelStore(e,k,rect);};return e;
  }
  /** Temporary selection surfaces participate in pixel/cache accounting but
   * never enter document publication, decoding, thumbnails or cel eviction. */
  transient(store){
    const e={id:'selection-'+(this.transientId=(this.transientId??0)+1),store,transient:true,pinned:true,stamp:0,levelsUsed:0,owner:this};
    this.transients.add(e);return this.rasterPresenter(e);
  }
  releaseTransient(e){if(!this.transients.delete(e))return;e.disposed=true;this.dropScratch(e);e.store=null;e.levels=null;e.levelKnown=null;this.residentMemory();}
  presenter(figure){
    const e=this.rasterPresenter(this.entry(figure));
    // An evicted store re-decodes here, not on the next stroke: superseded
    // decodes retry freely, real failures back off behind decodeError.
    if(!e.store&&!e.loading&&!e.decodeError)this.surface(figure).catch(error=>{if(error.name==='AbortError')return;e.decodeError=error;this.onError(error);});
    if(!e.store&&!e.loading)this.schedule();
    return e;
  }
  present(e,dirty) {
    const rect=dirty?{x:dirty.x,y:dirty.y,width:(dirty.right??dirty.x+dirty.width)-dirty.x,height:(dirty.bottom??dirty.y+dirty.height)-dirty.y}:null;
    e.pixelStamp=(e.pixelStamp??0)+1;invalidateLevels(e,rect);
    e.stamp++;
    // Every anchored scratch keeps its own pending rect in level space; a
    // full-surface change (null) repaints the whole cover on next use.
    for(const s of e._scratches?.values()??[]){
      const scale=1<<s.level;
      const dr=rect?{x:Math.floor(rect.x/scale),y:Math.floor(rect.y/scale),width:Math.ceil((rect.x+rect.width)/scale)-Math.floor(rect.x/scale),height:Math.ceil((rect.y+rect.height)/scale)-Math.floor(rect.y/scale)}:(s.cover?{...s.cover}:null);
      if(!dr)continue;
      s.pending=s.pending?{x:Math.min(s.pending.x,dr.x),y:Math.min(s.pending.y,dr.y),width:Math.max(s.pending.x+s.pending.width,dr.x+dr.width)-Math.min(s.pending.x,dr.x),height:Math.max(s.pending.y+s.pending.height,dr.y+dr.height)-Math.min(s.pending.y,dr.y)}:dr;
    }
    this.onChange();
  }
  needsPreparation(command,direction){return needsDrawingPreparation(command,direction);}
  prepareChanges(command,direction,options){return prepareDrawingChanges(this,command,direction,options);}
  apply(figure,changes,direction,prepared) {
    const e=this.entry(figure),plan=prepared?.plan(changes,direction,e.id),added=plan?0:this.replacementBytes(e,changes,direction);
    // Rebuildable memory yields before an edit is ever rejected.
    if(!plan)this.reserve(Math.max(0,added),e);e.decodeError=null;
    if(e.store){
      if(plan)for(const t of plan.tiles){if(t.pixels)e.store.adopt(t.tx,t.ty,t.pixels,t.alphaBounds);else e.store.delete(t.tx,t.ty);}
      else applyTileChanges(e.store,changes,direction);
      e.store.prune();
    }
    else e.deferred.push({changes,direction});
    if(plan)prepared.consume(plan);
    e.revision++;const d=drawingMetadata(figure);d.revision=e.revision;
    if(d.version===2&&e.store)d.bounds=e.store.bounds?{...e.store.bounds}:null;
    let dirty=null;for(const c of changes){const rect={x:c.tx*TILE,y:c.ty*TILE,width:TILE,height:TILE};dirty=dirty?{x:Math.min(dirty.x,rect.x),y:Math.min(dirty.y,rect.y),width:Math.max(dirty.x+dirty.width,rect.x+rect.width)-Math.min(dirty.x,rect.x),height:Math.max(dirty.y+dirty.height,rect.y+rect.height)-Math.min(dirty.y,rect.y)}:rect;}
    this.present(e,dirty);this.schedule();
  }
  checkHistory(command,direction,prepared){
    prepared?.validate(command,direction);
    const pending=new Map();const visit=c=>{if(c.commands){for(const child of direction==='before'?[...c.commands].reverse():c.commands)visit(child);}else if(c.kind==='drawing-pixels'){validateDrawingChanges(c.tiles);let tiles=pending.get(c.celId);if(!tiles)pending.set(c.celId,tiles=new Map());for(const tile of c.tiles)tiles.set(tileKey(tile.tx,tile.ty),sideBytes(tile[direction]));}};visit(command);
    let added=0;for(const [id,tiles] of pending){const changes=[...tiles].map(([key,bytes])=>{const [tx,ty]=key.split(',').map(Number);return{tx,ty,pixels:bytes?{byteLength:bytes}:null};});added+=this.replacementBytes(this.entries.get(id)??{},changes,'pixels');}
    this.reserve(Math.max(0,added-(prepared?.bytes??0)));
  }
  captureClipboard(clipboard){
    const snapshots=new Map();for(const figure of clipboard.figures??[]){if(!drawingMetadata(figure))continue;const e=this.entry(figure);snapshots.set(e.id,{published:e.published?{...e.published}:null,revision:e.revision,store:e.store?.fork()??null,deferred:e.deferred.slice()});}clipboardPixels.set(clipboard,snapshots);
  }
  checkClipboard(forks,clipboard){let bytes=0;const snapshots=clipboardPixels.get(clipboard);for(const [figure] of forks)bytes+=snapshots?.get(drawingMetadata(figure).celId)?.store?.bytes??0;this.reserve(bytes);}
  pasteClipboard(forks,clipboard){
    const snapshots=clipboardPixels.get(clipboard);
    for(const [old,copy] of forks){const source=snapshots?.get(drawingMetadata(old).celId);if(!source)continue;const e=this.entry(copy);
      e.published=source.published?{...source.published}:null;e.revision=source.revision;e.store=source.store?source.store.fork():null;e.deferred=source.deferred?.slice()??[];e.levels=null;e.levelKnown=null;this.dropScratch(e);
      this.schedule();}
    this.residentMemory();
  }
  /** Forks share tiles copy-on-write, so only tiles already evicted to a
   * data URL (or replaced later) add unique bytes; the delta check stays a
   * cheap estimate and apply() enforces the real budget at write time. */
  checkForks(figures){
    const resident=this.residentPixels();let added=0;
    for(const figure of figures){const store=this.entry(figure).store;if(!store)continue;for(const t of store)if(!resident.has(t.pixels))added+=t.pixels.byteLength;}
    this.reserve(added);
  }
  fork(old,copy) {
    const source=this.entry(old),target=this.entry(copy);
    target.published=source.published?{...source.published}:null;target.revision=source.revision;
    // History may have changed an evicted store without decoding it. Fork the
    // immutable base plus its pending operations, never just the old blob.
    target.deferred=source.deferred.slice();
    if(source.store){target.store=source.store.fork();target.levels=null;this.dropScratch(target);}
    // An in-flight source decode can include later source edits. Decode the
    // fork's own base and captured operations independently instead.
    this.residentMemory();this.schedule();
  }
  schedule(){if(this.timer||this.encoding||this.disposed||this._busy)return;this.timer=setTimeout(()=>{this.timer=null;if(this._busy)return;this.flush().catch(this.onError);},80);}
  async flush({signal}={}) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    if(this.encoding){await this.encoding;return this.flush({signal});}
    clearTimeout(this.timer);this.timer=null;
    for(const figure of this.report.figure_types){const entry=this.entries.get(drawingMetadata(figure)?.celId);if(entry)this.restorePublication(entry,figure);}
    const e=[...this.entries.values()].find(e=>!e.pinned&&e.published?.revision!==e.revision&&this.report.figure_types.some(f=>drawingMetadata(f)?.celId===e.id));
    if(!e)return;
    if(signal?.aborted)throw new DOMException('Drawing publication cancelled.','AbortError');
    if(!e.store){const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);if(!figure)return;await this.surface(figure);return this.flush({signal});}
    const revision=e.revision,generation=this.generation,reservation={};
    // Register the job before reserving its transfers: reserve() can itself
    // request publication. No pixel copying runs inside the editor commit.
    this.encoding=Promise.resolve().then(async()=>{
      const active=()=>!this.disposed&&!e.disposed&&e.store&&generation===this.generation&&revision===e.revision;
      const checkAbort=()=>{if(signal?.aborted)throw new DOMException('Drawing publication cancelled.','AbortError');};
      checkAbort();if(!active())return;
      const store=e.store,storeRevision=store.revision,tiles=[...store].filter(t=>!tileTransparent(t));
      const current=()=>active()&&e.store===store&&store.revision===storeRevision;
      store.freeze();
      // Tiles keep their worker-encoded PNG until a mutation clears it, so a
      // re-publish ships pixels only for changed tiles; the worker reassembles
      // the whole blob from its per-cel cache plus these fresh encodes.
      const keep=tiles.map(t=>tileKey(t.tx,t.ty));
      const sent=new Map(tiles.map(t=>[tileKey(t.tx,t.ty),t]));let encoded=0;
      let reserved=0;
      const send=async pending=>{
        let index=0,result;
        do{
          checkAbort();if(!current())return null;
          const first=index===0,batch=[];let bytes=0;
          while(index<pending.length){
            const tile=pending[index];
            // Older files can carry large ancillary PNG chunks. Re-encode
            // their tiny pixel tile instead of exceeding the transfer bound.
            const png=tile.png?.byteLength<=PUBLICATION_BATCH_BYTES?tile.png:null,size=png?.byteLength??tile.pixels.byteLength;
            if(batch.length&&bytes+size>PUBLICATION_BATCH_BYTES)break;
            batch.push({tx:tile.tx,ty:tile.ty,png,pixels:tile.pixels});bytes+=size;index++;
          }
          // Only one bounded transfer is alive at a time, including while the
          // worker owns its bytes. Cached PNG recovery obeys the same budget.
          if(bytes>reserved){this.hold(reservation,bytes,e);reserved=bytes;}
          const fresh=batch.map(t=>({tx:t.tx,ty:t.ty,...(t.png?{png:t.png.slice().buffer}:{pixels:t.pixels.slice().buffer})}));
          const partial=index<pending.length;
          result=await this.worker.request('encode-tiles',{celId:e.id,partial,...(first||!partial?{keep}:{}),tiles:fresh},{signal,transfer:fresh.map(t=>t.pixels??t.png)});
          checkAbort();if(!current())return null;
          encoded+=result.encoded??0;
          for(const t of result.tiles??[]){const tile=sent.get(tileKey(t.tx,t.ty));if(tile&&store.get(t.tx,t.ty)===tile)tile.png=new Uint8Array(t.png);}
        }while(index<pending.length);
        return result;
      };
      let result=await send(tiles.filter(t=>!t.png));
      if(!result)return;
      if(result.missing?.length){
        // The worker cache lost PNGs the store still trusts; resend them once.
        const wanted=new Set(result.missing);
        result=await send(tiles.filter(t=>wanted.has(tileKey(t.tx,t.ty))));
        if(!result)return;
        if(result.missing?.length)throw new Error('The drawing encoder lost its tile cache. Try again.');
      }
      if(!current())return;
      // Tiles replaced since the snapshot carry stale bytes; publish again.
      if(tiles.some(t=>e.store.get(t.tx,t.ty)!==t))return;
      this.lastEncode={encoded,reused:tiles.length-encoded};
      // This is derived publication, never a semantic editor edit.
      e.published={revision,url:tiles.length?result.blobUrl:null,bounds:e.store.bounds?{...e.store.bounds}:null};e.failed=null;
      const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);
      if(figure)this.restorePublication(e,figure);
      this.surfaceVersion++;this.onChange();
    });
    try{await this.encoding;}catch(error){e.failed=error;throw error;}finally{this.hold(reservation,0);this.encoding=null;}
    return this.flush({signal});
  }
  collectHistory(commands){
    this.history?.retain(commands);
    const retained=new Set(),visit=command=>{if(command.celId)retained.add(command.celId);for(const child of command.commands??[])visit(child);const change=command.assets?.figure_types;for(const list of [change?.added,change?.before,change?.after])for(const figure of list??[]){const id=drawingMetadata(figure)?.celId;if(id)retained.add(id);}};
    for(const command of commands)visit(command);this.collect(retained);
  }
  collect(retained=new Set()) {
    const reachable=new Set(this.report.figure_types.map(f=>drawingMetadata(f)?.celId));
    for(const [id,e] of this.entries)if(!reachable.has(id)&&!retained.has(id)&&!e.pinned){e.disposed=true;this.dropScratch(e);e.store=null;e.levels=null;e.levelKnown=null;this.entries.delete(id);}
    this.residentMemory();
  }
  dispose(){if(this.disposed)return this.disposal;this.disposed=true;this.disposal=this.history?.dispose().catch(()=>{})??Promise.resolve();this.previews?.dispose();this.generation++;clearTimeout(this.timer);this.worker.dispose();this.decodeWorker.dispose();this.thumbnailWorker.dispose();this.compositeWorker.dispose();if(this.strokeWorker.close)this.strokeWorker.close();else this.strokeWorker.dispose();this.thumbnailQueue.clear();for(const t of this.thumbnailCache.values())t.canvas.width=t.canvas.height=1;this.thumbnailCache.clear();for(const job of this.decodeQueue)job.reject(new DOMException('Drawing document closed.','AbortError'));this.decodeQueue=[];for(const e of this.surfaces()){this.dropScratch(e);e.disposed=true;e.store=null;e.levels=null;e.levelKnown=null;}this.transients.clear();this.entries.clear();this.pixelMemory.dispose();this.working?.clear();owners.delete(this.report);return this.disposal;}
}
