import {drawingMetadata,EMPTY_PNG} from './drawing-model.mjs';
import {TileStore,TILE,TILE_BYTES,tileKey,tileTransparent} from './drawing-tiles.mjs';
import {applyTileChanges} from './drawing-pixels.mjs';
import {tileStoreFromList} from './drawing-tile-codec.mjs';
import {presenterScratch,levelStore,invalidateLevels} from './drawing-raster.mjs';

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
  constructor(){this.next=1;this.pending=new Map();}
  request(kind,payload,{signal,transfer}={}) {
    if(signal?.aborted)return Promise.reject(new DOMException('Drawing operation cancelled.','AbortError'));
    if(this.pending.size>=2)return Promise.reject(new Error('Drawing worker is busy. Wait for the current operation.'));
    if(!this.worker){
      this.worker=new Worker(new URL('./drawing-worker.mjs',import.meta.url),{type:'module',name:'StykAnimate drawing pixels'});
      this.worker.onmessage=({data})=>{const pending=this.pending.get(data.id);if(!pending)return;this.pending.delete(data.id);pending.finish(data.error?new Error(data.error):null,data);};
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
  post(message,transfer){this.open();this.worker.postMessage(message,transfer??[]);}
  dispose(){this.worker?.terminate();this.worker=null;}
}

const sideBytes=s=>s==null?0:s.byteLength===4?TILE_BYTES:s.byteLength;
const tilePayload=(store,rect)=>{const tiles=[];for(const [tx,ty] of TileStore.tilesInRect(rect.x,rect.y,rect.width,rect.height)){const tile=store.get(tx,ty);if(tile)tiles.push({tx,ty,pixels:tile.pixels.slice().buffer});}return tiles;};

/** The tile store is the single authoritative raster. Publications are derived:
 * the per-tile PNG blob on image_assets[0].styk_tiles plus a bounds-sized
 * preview PNG on data_url keep legacy asset consumers working. */
export class DrawingResources {
  constructor(report,{tileBytes=192*1024*1024,levelBytes=64*1024*1024,scratchBytes=64*1024*1024,onChange=()=>{},onError=()=>{},worker,strokeWorker}={}) {
    Object.assign(this,{report,tileBudget:tileBytes,levelBudget:levelBytes,scratchBudget:scratchBytes,onChange,onError,entries:new Map(),worker:worker??new DrawingWorker(),decodeWorker:worker??new DrawingWorker(),strokeWorker:strokeWorker??new StrokeWorker(),generation:1,surfaceVersion:0,decodeQueue:[],thumbnailQueue:new Map(),thumbnailCache:new Map(),thumbnailWorker:worker??new DrawingWorker()});owners.set(report,this);
  }
  entry(figure) {
    const d=drawingMetadata(figure);let entry=this.entries.get(d.celId);
    if(!entry){entry={id:d.celId,store:null,revision:d.revision,published:null,loading:null,pinned:false,used:performance.now(),stamp:0,dirty:null,deferred:[],levels:null,levelsUsed:0,owner:this};this.entries.set(d.celId,entry);}return entry;
  }
  get stats(){let tiles=0,bytes=0,levelBytes=0,scratchBytes=0,unpublished=0;for(const e of this.entries.values()){if(e.store){tiles+=e.store.size;bytes+=e.store.bytes;}for(const level of e.levels??[])levelBytes+=level?.bytes??0;if(e._scratch?.canvas)scratchBytes+=e._scratch.canvas.width*e._scratch.canvas.height*4;if((e.store||e.deferred?.length)&&e.published?.revision!==e.revision)unpublished++;}return {tiles,bytes,levelBytes,scratchBytes,entries:this.entries.size,unpublished,inFlight:this.encoding?1:0};}
  dropScratch(e){if(!e._scratch)return;if(e._scratch.canvas)e._scratch.canvas.width=e._scratch.canvas.height=1;e._scratch=null;}
  /** Rebuildable presenter scratch canvases yield to newer work first. */
  scratchReserved(entry){let bytes=this.stats.scratchBytes;for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){if(bytes<=this.scratchBudget)break;if(e===entry||!e._scratch?.canvas)continue;bytes-=e._scratch.canvas.width*e._scratch.canvas.height*4;this.dropScratch(e);}}
  /** Derived mip chains are the cheapest cache: evict least-recently-used first. */
  levelsReserved(entry){entry.levelsUsed=performance.now();let bytes=this.stats.levelBytes;for(const e of [...this.entries.values()].sort((a,b)=>a.levelsUsed-b.levelsUsed)){if(bytes<=this.levelBudget)break;if(e===entry||!e.levels)continue;bytes-=e.levels.reduce((n,l)=>n+(l?.bytes??0),0);e.levels=null;}}
  reserve(bytes,except) {
    const resident=()=>this.stats.bytes;
    if(resident()+bytes<=this.tileBudget)return;
    // Rebuildable memory frees before authoritative tiles: presenter
    // scratches, then derived mip levels, then published-and-clean stores.
    for(const e of this.entries.values())if(e!==except)this.dropScratch(e);
    for(const e of this.entries.values())if(e!==except)e.levels=null;
    for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){
      if(resident()+bytes<=this.tileBudget)break;
      if(e===except||e.pinned||!e.store||e.published?.revision!==e.revision)continue;e.store=null;e.levels=null;this.surfaceVersion++;
    }
    if(resident()+bytes>this.tileBudget)throw new Error('Drawing memory is full. Choose 1× resolution or finish the current edit.');
  }
  /** Move an in-flight or resident entry under a new cel id (lazy migration). */
  retarget(oldCelId,figure){const e=this.entries.get(oldCelId),d=drawingMetadata(figure);if(!e||!d||d.celId===oldCelId)return;this.entries.delete(oldCelId);e.id=d.celId;this.entries.set(e.id,e);}
  /** Install decoded/resampled tiles under a figure's cel (publication follows). */
  install(figure,tiles){
    const e=this.entry(figure),store=new TileStore();
    for(const t of tiles??[])store.set(t.tx,t.ty,new Uint8ClampedArray(t.pixels));
    e.store=store;e.deferred=[];e.published=null;e.revision=drawingMetadata(figure).revision;e.stamp++;e.dirty=store.bounds?{...store.bounds}:null;e.levels=null;this.dropScratch(e);this.surfaceVersion++;this.onChange();this.schedule();return e;
  }
  discard(figure){const id=drawingMetadata(figure)?.celId,e=this.entries.get(id);if(!e||this.report.figure_types.some(f=>drawingMetadata(f)?.celId===id))return;this.entries.delete(id);this.surfaceVersion++;this.onChange();}
  async surface(figure) {
    const e=this.entry(figure);e.used=performance.now();
    if(e.store)return e;
    if(e.loading)return e.loading;
    const generation=this.generation,base=e.revision-(e.deferred?.length??0);
    e.loading=(async()=>{
      const d=drawingMetadata(figure),asset=figure.image_assets[0];
      const result=await this.decode(e,()=>d.version===1?this.decodeWorker.request('decode-legacy',{url:asset.data_url,crop:d.crop}):asset.styk_tiles?this.decodeWorker.request('decode-tiles',{url:asset.styk_tiles}):Promise.resolve({tiles:[]}));
      if(this.disposed||generation!==this.generation)throw new DOMException('Drawing changed.','AbortError');
      const store=tileStoreFromList(result.tiles);
      for(const step of e.deferred)applyTileChanges(store,step.changes,step.direction);
      e.deferred=[];this.reserve(store.bytes,e);e.store=store;e.stamp++;e.dirty=null;e.levels=null;this.dropScratch(e);this.surfaceVersion++;
      e.published??={revision:base,url:d.version===2?asset.styk_tiles??null:null};
      this.onChange();return e;
    })().finally(()=>{e.loading=null;});return e.loading;
  }
  decode(e,request){
    return new Promise((resolve,reject)=>{
      if(this.decodeQueue.length>=2)this.decodeQueue.shift().reject(new DOMException('A newer drawing was requested.','AbortError'));
      this.decodeQueue.push({e,request,resolve,reject});this.pumpDecode();
    });
  }
  pumpDecode(){
    if(this.decoding||this.disposed||!this.decodeQueue.length)return;
    const job=this.decodeQueue.shift();this.decoding=true;
    job.request().then(job.resolve,job.reject).finally(()=>{this.decoding=false;this.pumpDecode();});
  }
  thumbnail(figure,onReady){
    const d=drawingMetadata(figure),e=this.entries.get(d.celId),version=e?.revision??d.revision,hit=this.thumbnailCache.get(d.celId);
    if(hit?.version===version)return hit.canvas;
    if(!this.thumbnailQueue.has(d.celId)&&this.thumbnailActive!==d.celId){
      if(this.thumbnailQueue.size>=48)this.thumbnailQueue.delete(this.thumbnailQueue.keys().next().value);
      this.thumbnailQueue.set(d.celId,{figure,onReady,version});this.pumpThumbnail();
    }
    return hit?.canvas;
  }
  pumpThumbnail(){
    if(this.thumbnailActive||this.disposed||!this.thumbnailQueue.size)return;
    const [id,job]=this.thumbnailQueue.entries().next().value;this.thumbnailQueue.delete(id);this.thumbnailActive=id;
    const d=drawingMetadata(job.figure),e=this.entries.get(id),asset=job.figure.image_assets[0];
    const payload=e?.store?{bounds:e.store.bounds,tiles:e.store.bounds?tilePayload(e.store,e.store.bounds):[]}
      :d.version===1?{legacy:{url:asset.data_url,crop:d.crop}}:asset.styk_tiles?{url:asset.styk_tiles}:{bounds:null,tiles:[]};
    const transfers=payload.tiles?.map(t=>t.pixels)??[];
    this.thumbnailWorker.request('thumbnail',payload,{transfer:transfers}).then(result=>{
      if(this.disposed)return;const c=document.createElement('canvas');c.width=result.width;c.height=result.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels),c.width,c.height),0,0);
      this.thumbnailCache.get(id)?.canvas.remove();this.thumbnailCache.set(id,{version:job.version,canvas:c});while(this.thumbnailCache.size>256){const [old,entry]=this.thumbnailCache.entries().next().value;entry.canvas.width=entry.canvas.height=1;this.thumbnailCache.delete(old);}job.onReady?.();
    },error=>{if(error.name!=='AbortError')this.onError(error);}).finally(()=>{this.thumbnailActive=null;this.pumpThumbnail();});
  }
  /** The renderer-facing presenter: the live store plus scratch and mip
   * rasterizers. Levels are entry-owned caches rebuilt lazily and evicted
   * first under memory pressure. */
  presenter(figure){const e=this.entry(figure);e.used=performance.now();e.scratch??=(rect,options)=>presenterScratch(e,rect,options);e.level??=k=>{e.levelsUsed=performance.now();return levelStore(e,k);};return e;}
  present(e,dirty) {
    const rect=dirty?{x:dirty.x,y:dirty.y,width:(dirty.right??dirty.x+dirty.width)-dirty.x,height:(dirty.bottom??dirty.y+dirty.height)-dirty.y}:null;
    invalidateLevels(e,rect);
    e.stamp++;e.dirty=rect?(e.dirty?{x:Math.min(e.dirty.x,rect.x),y:Math.min(e.dirty.y,rect.y),width:Math.max(e.dirty.x+e.dirty.width,rect.x+rect.width)-Math.min(e.dirty.x,rect.x),height:Math.max(e.dirty.y+e.dirty.height,rect.y+rect.height)-Math.min(e.dirty.y,rect.y)}:rect):null;
    this.onChange();
  }
  apply(figure,changes,direction) {
    const e=this.entry(figure);let added=0;
    for(const c of changes)added+=sideBytes(c[direction])-sideBytes(e.store?.get(c.tx,c.ty)?.pixels??null);
    if(this.stats.bytes+Math.max(0,added)>this.tileBudget)throw new Error('Drawing publication is behind. Save or retry encoding before painting more.');
    if(e.store){applyTileChanges(e.store,changes,direction);e.store.prune();}
    else e.deferred.push({changes,direction});
    e.revision++;const d=drawingMetadata(figure);d.revision=e.revision;
    if(d.version===2&&e.store)d.bounds=e.store.bounds?{...e.store.bounds}:null;
    let dirty=null;for(const c of changes){const rect={x:c.tx*TILE,y:c.ty*TILE,width:TILE,height:TILE};dirty=dirty?{x:Math.min(dirty.x,rect.x),y:Math.min(dirty.y,rect.y),width:Math.max(dirty.x+dirty.width,rect.x+rect.width)-Math.min(dirty.x,rect.x),height:Math.max(dirty.y+dirty.height,rect.y+rect.height)-Math.min(dirty.y,rect.y)}:rect;}
    this.present(e,dirty);this.schedule();
  }
  checkHistory(command,direction){
    const pending=new Map();const visit=c=>{if(c.commands){for(const child of direction==='before'?[...c.commands].reverse():c.commands)visit(child);}else if(c.kind==='drawing-pixels'){let tiles=pending.get(c.celId);if(!tiles)pending.set(c.celId,tiles=new Map());for(const tile of c.tiles)tiles.set(tileKey(tile.tx,tile.ty),sideBytes(tile[direction]));}};visit(command);
    let added=0;for(const [id,tiles] of pending)for(const [key,bytes] of tiles){const [tx,ty]=key.split(',').map(Number);added+=bytes-sideBytes(this.entries.get(id)?.store?.get(tx,ty)?.pixels??null);}
    if(this.stats.bytes+Math.max(0,added)>this.tileBudget)throw new Error('Wait for drawing publication or retry it before undoing.');
  }
  captureClipboard(clipboard){
    const snapshots=new Map();for(const figure of clipboard.figures??[]){if(!drawingMetadata(figure))continue;const e=this.entry(figure);snapshots.set(e.id,{published:e.published?{...e.published}:null,revision:e.revision,store:e.store?.fork()??null,loading:e.loading});}clipboardPixels.set(clipboard,snapshots);
  }
  checkClipboard(forks,clipboard){let bytes=0;const snapshots=clipboardPixels.get(clipboard);for(const [figure] of forks)bytes+=snapshots?.get(drawingMetadata(figure).celId)?.store?.bytes??0;if(this.stats.bytes+bytes>this.tileBudget)throw new Error('Wait for drawing publication before pasting.');}
  pasteClipboard(forks,clipboard){
    const snapshots=clipboardPixels.get(clipboard);
    for(const [old,copy] of forks){const source=snapshots?.get(drawingMetadata(old).celId);if(!source)continue;const e=this.entry(copy);
      e.published=source.published?{...source.published}:null;e.revision=source.revision;e.store=source.store?source.store.fork():null;e.deferred=[];e.levels=null;this.dropScratch(e);
      if(source.loading&&!e.store)e.loading=source.loading.then(entry=>{if(!e.store)e.store=entry.store?.fork()??null;return e;});
      this.schedule();}
  }
  checkForks(figures){let bytes=0;for(const figure of figures)bytes+=this.entry(figure).store?.bytes??0;if(this.stats.bytes+bytes>this.tileBudget)throw new Error('Wait for drawing publication before copying more drawings.');}
  fork(old,copy) {
    const source=this.entry(old),target=this.entry(copy);
    target.published=source.published?{...source.published}:null;target.revision=source.revision;target.deferred=[];
    if(source.store){if(source.store.bytes>this.tileBudget-this.stats.bytes)throw new Error('Wait for drawing publication before copying more drawings.');target.store=source.store.fork();target.levels=null;this.dropScratch(target);}
    else if(source.loading)target.loading=source.loading.then(entry=>{if(!target.store)target.store=entry.store?.fork()??null;return target;});
    this.schedule();
  }
  schedule(){if(this.timer||this.encoding||this.disposed)return;this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(this.onError);},80);}
  async flush({signal}={}) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    if(this.encoding){await this.encoding;return this.flush({signal});}
    clearTimeout(this.timer);this.timer=null;
    const e=[...this.entries.values()].find(e=>!e.pinned&&e.published?.revision!==e.revision&&this.report.figure_types.some(f=>drawingMetadata(f)?.celId===e.id));
    if(!e)return;
    if(signal?.aborted)throw new DOMException('Drawing publication cancelled.','AbortError');
    if(!e.store){const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);if(!figure)return;await this.surface(figure);return this.flush({signal});}
    const revision=e.revision,generation=this.generation,figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);
    this.encoding=(async()=>{
      const tiles=[...e.store].filter(t=>!tileTransparent(t));
      // Missing PNGs encode in the worker, which also assembles and base64s
      // the publication blob so the main thread never builds it.
      const payload=tiles.map(t=>t.png?{tx:t.tx,ty:t.ty,png:t.png.slice().buffer}:{tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer});
      const result=await this.worker.request('encode-tiles',{tiles:payload},{signal,transfer:payload.flatMap(t=>[t.pixels,t.png].filter(Boolean))});
      if(this.disposed||generation!==this.generation||revision!==e.revision)return;
      // Tiles replaced since the snapshot carry stale bytes; publish again.
      if(tiles.some(t=>e.store.get(t.tx,t.ty)!==t))return;
      const sent=new Map(tiles.map(t=>[tileKey(t.tx,t.ty),t]));
      for(const t of result.tiles??[]){const tile=sent.get(tileKey(t.tx,t.ty));if(tile&&e.store.get(t.tx,t.ty)===tile)tile.png=new Uint8Array(t.png);}
      e.store.freeze();
      const asset=figure.image_assets[0],d=drawingMetadata(figure);
      if(tiles.length)asset.styk_tiles=result.blobUrl;else delete asset.styk_tiles;
      asset.data_url=EMPTY_PNG;asset.width=asset.height=asset.display_width=asset.display_height=1;
      // This is derived publication, never a semantic editor edit.
      d.bounds=e.store.bounds?{...e.store.bounds}:null;d.revision=revision;
      e.published={revision,url:asset.styk_tiles??null};e.failed=null;
      this.surfaceVersion++;this.onChange();
    })();
    try{await this.encoding;}catch(error){e.failed=error;throw error;}finally{this.encoding=null;}
    return this.flush({signal});
  }
  collectHistory(commands){
    const retained=new Set(),visit=command=>{if(command.celId)retained.add(command.celId);for(const child of command.commands??[])visit(child);const change=command.assets?.figure_types;for(const list of [change?.added,change?.before,change?.after])for(const figure of list??[]){const id=drawingMetadata(figure)?.celId;if(id)retained.add(id);}};
    for(const command of commands)visit(command);this.collect(retained);
  }
  collect(retained=new Set()) {
    const reachable=new Set(this.report.figure_types.map(f=>drawingMetadata(f)?.celId));
    for(const [id,e] of this.entries)if(!reachable.has(id)&&!retained.has(id)&&!e.pinned)this.entries.delete(id);
  }
  dispose(){this.disposed=true;this.generation++;clearTimeout(this.timer);this.worker.dispose();this.decodeWorker.dispose();this.thumbnailWorker.dispose();this.strokeWorker.dispose();this.thumbnailQueue.clear();for(const t of this.thumbnailCache.values())t.canvas.width=t.canvas.height=1;this.thumbnailCache.clear();for(const job of this.decodeQueue)job.reject(new DOMException('Drawing document closed.','AbortError'));this.decodeQueue=[];this.entries.clear();owners.delete(this.report);}
}
