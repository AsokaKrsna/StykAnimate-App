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
  constructor({maxPending=2}={}){this.next=1;this.pending=new Map();this.maxPending=maxPending;}
  request(kind,payload,{signal,transfer}={}) {
    if(signal?.aborted)return Promise.reject(new DOMException('Drawing operation cancelled.','AbortError'));
    if(this.pending.size>=this.maxPending)return Promise.reject(new Error('Drawing worker is busy. Wait for the current operation.'));
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
  post(message,transfer){if(this.closed)return;this.open();this.worker.postMessage(message,transfer??[]);}
  // dispose() stays respawnable for crash recovery; close() is permanent.
  dispose(){this.worker?.terminate();this.worker=null;}
  close(){this.closed=true;this.dispose();}
}

const PUBLISH_CHUNK=96;
/** Resident tile budget from device memory: animation scrubbing wants many
 * cels resident. navigator.deviceMemory reports up to 8 (GiB). */
export function defaultTileBudget(memory=globalThis.navigator?.deviceMemory){const gib=Number.isFinite(memory)&&memory>0?memory:4;return Math.max(192,Math.min(512,gib*64))*1024*1024;}
// Mip levels the decode worker prepares: 4× drawings viewed at 100% use level 2.
const DECODE_LEVELS=3;
const sideBytes=s=>s==null?0:s.byteLength===4?TILE_BYTES:s.byteLength;
const tilePayload=(store,rect)=>{const tiles=[];for(const [tx,ty] of TileStore.tilesInRect(rect.x,rect.y,rect.width,rect.height)){const tile=store.get(tx,ty);if(tile)tiles.push({tx,ty,pixels:tile.pixels.slice().buffer});}return tiles;};

/** The tile store is the single authoritative raster. Publications are derived:
 * the per-tile PNG blob on image_assets[0].styk_tiles plus a bounds-sized
 * preview PNG on data_url keep legacy asset consumers working. */
export class DrawingResources {
  constructor(report,{tileBytes=defaultTileBudget(),levelBytes=64*1024*1024,scratchBytes=64*1024*1024,hardBytes,onChange=()=>{},onError=()=>{},worker,strokeWorker}={}) {
    // tileBudget is the retention target; hardBudget is the only point a
    // required working set is refused (at least 768 MiB). Between them, required dirty/pinned
    // tiles stay resident while publication frees them in the background.
    Object.assign(this,{report,tileBudget:tileBytes,hardBudget:hardBytes??Math.max(tileBytes*2,Math.min(tileBytes*4,768*1024*1024)),levelBudget:levelBytes,scratchBudget:scratchBytes,onChange,onError,entries:new Map(),worker:worker??new DrawingWorker(),decodeWorker:worker??new DrawingWorker(),strokeWorker:strokeWorker??new StrokeWorker(),generation:1,surfaceVersion:0,decodeQueue:[],thumbnailQueue:new Map(),thumbnailCache:new Map(),thumbnailWorker:worker??new DrawingWorker(),decodes:0,lastEncode:null,injectedWorker:Boolean(worker)});owners.set(report,this);
  }
  /** While a stroke session or scrub owns the UI thread, the publication
   * debounce and the thumbnail pump wait; clearing busy re-arms both. */
  set busy(value){value=Boolean(value);if(this._busy===value)return;this._busy=value;if(!value){this.schedule();this.pumpThumbnail();}}
  get busy(){return Boolean(this._busy);}
  entry(figure) {
    const d=drawingMetadata(figure);let entry=this.entries.get(d.celId);
    if(!entry){entry={id:d.celId,store:null,revision:d.revision,published:null,loading:null,decodeError:null,pinned:false,used:performance.now(),stamp:0,deferred:[],levels:null,levelsUsed:0,owner:this};this.entries.set(d.celId,entry);}return entry;
  }
  /** Resident tile bytes dedupe by pixel buffer: copy-on-write forks share
   * tiles, so shared tiles count once, not once per entry. */
  residentPixels(){const seen=new Set();for(const e of this.entries.values())if(e.store)for(const t of e.store)seen.add(t.pixels);return seen;}
  get stats(){let tiles=0,bytes=0,levelBytes=0,scratchBytes=0,unpublished=0;for(const e of this.entries.values()){if(e.store)tiles+=e.store.size;for(const level of e.levels??[])levelBytes+=level?.bytes??0;for(const s of e._scratches?.values()??[])if(s.canvas)scratchBytes+=s.canvas.width*s.canvas.height*4;if((e.store||e.deferred?.length)&&e.published?.revision!==e.revision)unpublished++;}for(const pixels of this.residentPixels())bytes+=pixels.byteLength;return {tiles,bytes,levelBytes,scratchBytes,entries:this.entries.size,unpublished,inFlight:this.encoding?1:0,workers:[this.worker,this.decodeWorker,this.thumbnailWorker,this.strokeWorker].filter(w=>w.worker).length,decodes:this.decodes,lastEncode:this.lastEncode};}
  dropScratch(e){const map=e._scratches;if(!map)return;for(const s of map.values())if(s.canvas)s.canvas.width=s.canvas.height=1;e._scratches=null;}
  /** Rebuildable presenter scratch canvases yield to newer work first. */
  scratchReserved(entry){let bytes=this.stats.scratchBytes;for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){if(bytes<=this.scratchBudget)break;if(e===entry||!e._scratches?.size)continue;for(const s of e._scratches.values())if(s.canvas)bytes-=s.canvas.width*s.canvas.height*4;this.dropScratch(e);}}
  /** Derived mip chains are the cheapest cache: evict least-recently-used first. */
  levelsReserved(entry){entry.levelsUsed=performance.now();let bytes=0;for(const e of this.entries.values())for(const level of e.levels??[])bytes+=(level?.size??0)*TILE_BYTES;for(const e of [...this.entries.values()].sort((a,b)=>a.levelsUsed-b.levelsUsed)){if(bytes<=this.levelBudget)break;if(e===entry||!e.levels)continue;bytes-=e.levels.reduce((n,l)=>n+(l?.bytes??0),0);e.levels=null;}}
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
    if(resident()+bytes<=this.tileBudget)return;
    // Everything left is dirty or pinned work that must not be lost. Kick the
    // publication pump so those stores become evictable, and hold the required
    // set above the soft budget rather than rejecting the edit.
    this.flush().catch(this.onError);
    if(resident()+bytes>this.hardBudget)throw new Error('Drawing memory is full. Choose 1× resolution or finish the current edit.');
  }
  /** Parallel PNG codec workers for large publications and cold decodes,
   * spawned on first use. */
  encoders(){
    if(!this._encoders){const count=this.injectedWorker?1:Math.max(1,Math.min(4,(globalThis.navigator?.hardwareConcurrency??4)-2));this._encoders=Array.from({length:count},(_,i)=>i===0&&this.injectedWorker?this.worker:new DrawingWorker({maxPending:8}));}
    return this._encoders;
  }
  /** Decode a published blob across the pool, one spatial shard per worker,
   * and merge tiles and mip levels. */
  async decodeTiles(url){
    const pool=this.encoders(),count=pool.length;
    if(count===1||url.length<256*1024)return this.decodeWorker.request('decode-tiles',{url,levels:DECODE_LEVELS});
    const parts=await Promise.all(pool.map((worker,index)=>worker.request('decode-tiles',{url,levels:DECODE_LEVELS,shard:[index,count]})));
    const levels=[];for(const part of parts)part.levels?.forEach((list,k)=>{(levels[k]??=[]).push(...list);});
    // Trim empty trailing levels (shards report every depth).
    while(levels.length&&!levels.at(-1).length)levels.pop();
    return {tiles:parts.flatMap(p=>p.tiles),levels};
  }
  /** Strokes adopt tiles without reserving, and dirty work may exceed the
   * budget until it publishes; once everything is published, evict clean
   * stores back under the budget, keeping the most recently used cel. */
  trim(){
    if(this.disposed)return;let bytes=this.stats.bytes;if(bytes<=this.tileBudget)return;
    const stores=[...this.entries.values()].filter(e=>e.store).sort((a,b)=>a.used-b.used),current=stores.at(-1);let evicted=false;
    for(const e of stores){
      if(bytes<=this.tileBudget)break;
      if(e===current||e.pinned||e.published?.revision!==e.revision)continue;
      e.store=null;e.levels=null;this.dropScratch(e);this.surfaceVersion++;bytes=this.stats.bytes;evicted=true;
    }
    if(evicted)this.onChange();
  }
  /** Move an in-flight or resident entry under a new cel id (lazy migration). */
  retarget(oldCelId,figure){const e=this.entries.get(oldCelId),d=drawingMetadata(figure);if(!e||!d||d.celId===oldCelId)return;this.entries.delete(oldCelId);e.id=d.celId;this.entries.set(e.id,e);}
  /** Install decoded/resampled tiles under a figure's cel (publication follows). */
  install(figure,tiles){
    const e=this.entry(figure),store=new TileStore();
    for(const t of tiles??[])store.set(t.tx,t.ty,new Uint8ClampedArray(t.pixels));
    e.store=store;e.deferred=[];e.published=null;e.revision=drawingMetadata(figure).revision;e.stamp++;e.decodeError=null;e.levels=null;this.dropScratch(e);this.surfaceVersion++;this.onChange();this.schedule();return e;
  }
  discard(figure){const id=drawingMetadata(figure)?.celId,e=this.entries.get(id);if(!e||this.report.figure_types.some(f=>drawingMetadata(f)?.celId===id))return;this.entries.delete(id);this.surfaceVersion++;this.onChange();}
  async surface(figure) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    const e=this.entry(figure);e.used=performance.now();
    if(e.store)return e;
    if(e.loading)return e.loading;
    const generation=this.generation,base=e.revision-(e.deferred?.length??0);
    e.loading=(async()=>{
      const d=drawingMetadata(figure);
      // History snapshots replace figure objects; the live report figure is
      // authoritative for the published asset behind this cel id.
      const live=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===d.celId)??figure,asset=live.image_assets[0];
      const result=await this.decode(e,()=>d.version===1?this.decodeWorker.request('decode-legacy',{url:asset.data_url,crop:d.crop}):asset.styk_tiles?this.decodeTiles(asset.styk_tiles):Promise.resolve({tiles:[]}));
      if(this.disposed||generation!==this.generation)throw new DOMException('Drawing changed.','AbortError');
      const store=tileStoreFromList(result.tiles);
      const exact=!e.deferred.length;
      for(const step of e.deferred)applyTileChanges(store,step.changes,step.direction);
      e.deferred=[];this.reserve(store.bytes,e);e.store=store;e.stamp++;e.decodeError=null;e.levels=null;this.dropScratch(e);this.surfaceVersion++;
      // Worker-built mip levels are valid only when no deferred edit changed the pixels.
      if(exact&&result.levels?.length){let below=store;e.levels=result.levels.map(list=>{const level=tileStoreFromList(list);level.scanned=below.size;below=level;return level;});this.levelsReserved(e);}
      e.published??={revision:base,url:d.version===2?asset.styk_tiles??null:null};
      this.onChange();return e;
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
      const bounds=e.store.bounds,k=bounds?Math.max(0,Math.min(4,Math.floor(Math.log2(Math.max(bounds.width,bounds.height)/64)))):0;
      const level=k?levelStore(e,k):e.store,levelBounds=level.bounds;
      payload={bounds:levelBounds,tiles:levelBounds?tilePayload(level,levelBounds):[]};
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
  presenter(figure){
    const e=this.entry(figure);e.used=performance.now();e.scratch??=(rect,options)=>presenterScratch(e,rect,options);e.level??=k=>{e.levelsUsed=performance.now();return levelStore(e,k);};
    // An evicted store re-decodes here, not on the next stroke: superseded
    // decodes retry freely, real failures back off behind decodeError.
    if(!e.store&&!e.loading&&!e.decodeError)this.surface(figure).catch(error=>{if(error.name==='AbortError')return;e.decodeError=error;this.onError(error);});
    if(!e.store&&!e.loading)this.schedule();
    return e;
  }
  present(e,dirty) {
    const rect=dirty?{x:dirty.x,y:dirty.y,width:(dirty.right??dirty.x+dirty.width)-dirty.x,height:(dirty.bottom??dirty.y+dirty.height)-dirty.y}:null;
    invalidateLevels(e,rect);
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
  apply(figure,changes,direction,{resident=false}={}) {
    const e=this.entry(figure);let added=0;
    if(resident&&e.store){
      // The live store already holds this side's pixels (a stroke adopted
      // them batch by batch and they are on screen): only drop tiles the edit
      // cleared, then record the revision. No copy, prune walk or repaint.
      let dirty=null;
      for(const c of changes)if(c[direction]==null&&e.store.has(c.tx,c.ty)){e.store.delete(c.tx,c.ty);const r={x:c.tx*TILE,y:c.ty*TILE,width:TILE,height:TILE};dirty=dirty?{x:Math.min(dirty.x,r.x),y:Math.min(dirty.y,r.y),width:Math.max(dirty.x+dirty.width,r.x+TILE)-Math.min(dirty.x,r.x),height:Math.max(dirty.y+dirty.height,r.y+TILE)-Math.min(dirty.y,r.y)}:r;}
      e.decodeError=null;e.revision++;const d=drawingMetadata(figure);d.revision=e.revision;
      if(d.version===2)d.bounds=e.store.bounds?{...e.store.bounds}:null;
      if(dirty)this.present(e,dirty);this.schedule();return;
    }
    for(const c of changes)added+=sideBytes(c[direction])-sideBytes(e.store?.get(c.tx,c.ty)?.pixels??null);
    // Rebuildable memory yields before an edit is ever rejected.
    this.reserve(Math.max(0,added),e);e.decodeError=null;
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
    this.reserve(Math.max(0,added));
  }
  captureClipboard(clipboard){
    const snapshots=new Map();for(const figure of clipboard.figures??[]){if(!drawingMetadata(figure))continue;const e=this.entry(figure);snapshots.set(e.id,{published:e.published?{...e.published}:null,revision:e.revision,store:e.store?.fork()??null,loading:e.loading});}clipboardPixels.set(clipboard,snapshots);
  }
  checkClipboard(forks,clipboard){let bytes=0;const snapshots=clipboardPixels.get(clipboard);for(const [figure] of forks)bytes+=snapshots?.get(drawingMetadata(figure).celId)?.store?.bytes??0;this.reserve(bytes);}
  pasteClipboard(forks,clipboard){
    const snapshots=clipboardPixels.get(clipboard);
    for(const [old,copy] of forks){const source=snapshots?.get(drawingMetadata(old).celId);if(!source)continue;const e=this.entry(copy);
      e.published=source.published?{...source.published}:null;e.revision=source.revision;e.store=source.store?source.store.fork():null;e.deferred=[];e.levels=null;this.dropScratch(e);
      if(source.loading&&!e.store)e.loading=source.loading.then(entry=>{if(!e.store)e.store=entry.store?.fork()??null;return e;});
      this.schedule();}
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
    target.published=source.published?{...source.published}:null;target.revision=source.revision;target.deferred=[];
    if(source.store){target.store=source.store.fork();target.levels=null;this.dropScratch(target);}
    else if(source.loading)target.loading=source.loading.then(entry=>{if(!target.store)target.store=entry.store?.fork()??null;return target;});
    this.schedule();
  }
  schedule(){if(this.timer||this.encoding||this.disposed||this._busy)return;this.timer=setTimeout(()=>{this.timer=null;if(this._busy)return;this.flush().catch(this.onError);},80);}
  async flush({signal}={}) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    if(this.encoding){await this.encoding;return this.flush({signal});}
    clearTimeout(this.timer);this.timer=null;
    const e=[...this.entries.values()].find(e=>!e.pinned&&e.published?.revision!==e.revision&&this.report.figure_types.some(f=>drawingMetadata(f)?.celId===e.id));
    if(!e){this.trim();return;}
    if(signal?.aborted)throw new DOMException('Drawing publication cancelled.','AbortError');
    if(!e.store){const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);if(!figure)return;await this.surface(figure);return this.flush({signal});}
    const revision=e.revision,generation=this.generation,figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);
    this.encoding=(async()=>{
      const tiles=[...e.store].filter(t=>!tileTransparent(t));
      // Tiles keep their worker-encoded PNG until a mutation clears it, so a
      // re-publish ships pixels only for changed tiles; the worker reassembles
      // the whole blob from its per-cel cache plus these fresh encodes.
      const keep=tiles.map(t=>tileKey(t.tx,t.ty));
      // Large publications stream through the worker's PNG cache in bounded
      // chunks, each copied just before it is sent, so no single main-thread
      // task copies every changed tile. Only the last chunk assembles the blob.
      // The encoder pool compresses them in parallel; the owning worker adopts
      // those PNGs into its cache and only assembles the blob.
      const pending=tiles.filter(t=>!t.png),primed=[],copy=list=>list.map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
      const stale=()=>this.disposed||generation!==this.generation||revision!==e.revision;
      if(pending.length>PUBLISH_CHUNK){
        const chunks=[];while(pending.length>PUBLISH_CHUNK)chunks.push(pending.splice(0,PUBLISH_CHUNK));
        let next=0;
        await Promise.all(this.encoders().map(async worker=>{while(next<chunks.length&&!stale()){const part=copy(chunks[next++]);const reply=await worker.request('encode-pngs',{tiles:part},{signal,transfer:part.map(t=>t.pixels)});primed.push(...reply.tiles);}}));
        if(stale())return;
      }
      let fresh=copy(pending);
      const pngs=primed.map(t=>({tx:t.tx,ty:t.ty,png:t.png.slice(0)}));
      let result=await this.worker.request('encode-tiles',{celId:e.id,keep,tiles:fresh,pngs},{signal,transfer:[...fresh.map(t=>t.pixels),...pngs.map(t=>t.png)]});
      if(result.missing?.length){
        if(this.disposed||generation!==this.generation||revision!==e.revision)return;
        // The worker cache lost PNGs the store still trusts; resend them once.
        const wanted=new Set(result.missing);
        fresh=[...e.store].filter(t=>wanted.has(tileKey(t.tx,t.ty))).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer}));
        result=await this.worker.request('encode-tiles',{celId:e.id,keep,tiles:fresh},{signal,transfer:fresh.map(t=>t.pixels)});
        if(result.missing?.length)throw new Error('The drawing encoder lost its tile cache. Try again.');
      }
      if(this.disposed||generation!==this.generation||revision!==e.revision)return;
      // Tiles replaced since the snapshot carry stale bytes; publish again.
      if(tiles.some(t=>e.store.get(t.tx,t.ty)!==t))return;
      const sent=new Map(tiles.map(t=>[tileKey(t.tx,t.ty),t]));
      for(const t of [...primed,...(result.tiles??[])]){const tile=sent.get(tileKey(t.tx,t.ty));if(tile&&e.store.get(t.tx,t.ty)===tile)tile.png=new Uint8Array(t.png);}
      this.lastEncode={encoded:result.encoded??0,reused:result.reused??0};
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
  dispose(){this.disposed=true;this.generation++;clearTimeout(this.timer);this.worker.dispose();for(const w of this._encoders??[])if(w!==this.worker)w.dispose();this.decodeWorker.dispose();this.thumbnailWorker.dispose();if(this.strokeWorker.close)this.strokeWorker.close();else this.strokeWorker.dispose();this.thumbnailQueue.clear();for(const t of this.thumbnailCache.values())t.canvas.width=t.canvas.height=1;this.thumbnailCache.clear();for(const job of this.decodeQueue)job.reject(new DOMException('Drawing document closed.','AbortError'));this.decodeQueue=[];this.entries.clear();owners.delete(this.report);}
}
