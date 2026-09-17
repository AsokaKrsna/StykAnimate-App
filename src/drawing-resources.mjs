import {drawingMetadata} from './drawing-model.mjs';
import {writeTile} from './drawing-pixels.mjs';

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
  request(kind,payload,{signal}={}) {
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
      this.worker.postMessage({id,kind,...payload});
    });
  }
  dispose(error=new DOMException('Drawing resources closed.','AbortError')){this.worker?.terminate();this.worker=null;for(const p of this.pending.values())p.finish(error);this.pending.clear();}
}

/** No runtime values enter the report. Dirty tile replacements are immutable
 * CPU snapshots; synchronous history replay never depends on decoding a PNG. */
export class DrawingResources {
  constructor(report,{decodedBytes=96*1024*1024,dirtyBytes=96*1024*1024,onChange=()=>{},onError=()=>{},worker}={}) {
    Object.assign(this,{report,decodedBudget:decodedBytes,dirtyBudget:dirtyBytes,onChange,onError,entries:new Map(),worker:worker??new DrawingWorker(),decodeWorker:worker??new DrawingWorker(),generation:1,surfaceVersion:0,decodeQueue:[],thumbnailQueue:new Map(),thumbnailCache:new Map(),thumbnailWorker:worker??new DrawingWorker()});owners.set(report,this);
  }
  entry(figure) {
    const d=drawingMetadata(figure);let entry=this.entries.get(d.celId);
    if(!entry){entry={id:d.celId,width:d.width,height:d.height,base:figure.image_assets[0].data_url,revision:d.revision,tiles:new Map(),used:performance.now(),stamp:0};this.entries.set(d.celId,entry);}return entry;
  }
  get stats(){let decoded=0,dirty=0;for(const e of this.entries.values()){decoded+=(e.pixels?.byteLength??0)*2;for(const t of e.tiles.values())dirty+=t.pixels.byteLength;}return {decoded,dirty,entries:this.entries.size,queued:[...this.entries.values()].filter(e=>e.tiles.size).length,inFlight:this.encoding?1:0};}
  reserve(bytes,except) {
    for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){
      if(this.stats.decoded+bytes<=this.decodedBudget)break;
      if(e===except||e.pinned)continue;e.pixels=null;if(e.canvas){e.canvas.width=1;e.canvas.height=1;e.canvas=null;this.surfaceVersion++;}
    }
    if(this.stats.decoded+bytes>this.decodedBudget)throw new Error('Drawing memory is full. Choose 1× resolution or finish the current edit.');
  }
  payload(e){return {width:e.width,height:e.height,base:e.base,tiles:[...e.tiles.values()]};}
  adoptSurface(figure,pixels){
    const e=this.entry(figure);this.reserve(e.width*e.height*8,e);e.pixels=new Uint8ClampedArray(pixels);
    if(e.pixels.length!==e.width*e.height*4){e.pixels=null;throw new Error('Invalid expanded drawing pixels.');}
    this.attachCanvas(e);return e;
  }
  attachCanvas(e){
    if(typeof document==='undefined')return;
    e.canvas=document.createElement('canvas');e.canvas.width=e.width;e.canvas.height=e.height;
    e.canvas.complete=true;e.canvas.naturalWidth=e.width;e.canvas.naturalHeight=e.height;
    e.context=e.canvas.getContext('2d');this.surfaceVersion++;this.present(e);
  }
  discard(figure){const id=drawingMetadata(figure)?.celId,e=this.entries.get(id);if(!e||this.report.figure_types.some(f=>drawingMetadata(f)?.celId===id))return;if(e.canvas)e.canvas.width=e.canvas.height=1;this.entries.delete(id);this.surfaceVersion++;this.onChange();}
  async surface(figure) {
    const e=this.entry(figure);e.used=performance.now();if(e.pixels)return e;
    if(e.loading)return e.loading;
    this.reserve(e.width*e.height*8,e);const generation=this.generation;
    e.loading=(async()=>{
      let result;do{result=await this.decode(e);if(this.disposed||generation!==this.generation)throw new DOMException('Drawing changed.','AbortError');}while(result.revision!==e.revision);
      if(this.disposed||generation!==this.generation)throw new DOMException('Drawing changed.','AbortError');
      this.reserve(e.width*e.height*8,e);e.pixels=new Uint8ClampedArray(result.pixels);
      // History may have applied newer tiles while decoding was in flight.
      for(const tile of e.tiles.values())writeTile(e.pixels,e.width,tile,new Uint8ClampedArray(tile.pixels));
      this.attachCanvas(e);
      return e;
    })().finally(()=>{e.loading=null;});return e.loading;
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
    this.thumbnailWorker.request('thumbnail',this.payload(this.entry(job.figure))).then(result=>{
      if(this.disposed)return;const c=document.createElement('canvas');c.width=result.width;c.height=result.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels),c.width,c.height),0,0);
      this.thumbnailCache.get(id)?.canvas.remove();this.thumbnailCache.set(id,{version:job.version,canvas:c});while(this.thumbnailCache.size>256){const [old,entry]=this.thumbnailCache.entries().next().value;entry.canvas.width=entry.canvas.height=1;this.thumbnailCache.delete(old);}job.onReady?.();
    },error=>{if(error.name!=='AbortError')this.onError(error);}).finally(()=>{this.thumbnailActive=null;this.pumpThumbnail();});
  }
  decode(e){
    return new Promise((resolve,reject)=>{
      if(this.decodeQueue.length>=2)this.decodeQueue.shift().reject(new DOMException('A newer drawing was requested.','AbortError'));
      this.decodeQueue.push({e,resolve,reject});this.pumpDecode();
    });
  }
  pumpDecode(){
    if(this.decoding||this.disposed||!this.decodeQueue.length)return;
    const job=this.decodeQueue.shift();this.decoding=true;
    const revision=job.e.revision;this.decodeWorker.request('decode',this.payload(job.e)).then(result=>job.resolve({...result,revision}),job.reject).finally(()=>{this.decoding=false;this.pumpDecode();});
  }
  present(e,dirty) {
    if(e.context&&e.pixels){const image=new ImageData(e.pixels,e.width,e.height);if(dirty)e.context.putImageData(image,0,0,dirty.x,dirty.y,dirty.right-dirty.x,dirty.bottom-dirty.y);else e.context.putImageData(image,0,0);}
    e.stamp++;const rect=dirty??{x:0,y:0,right:e.width,bottom:e.height},old=e.dirtyRect;e.dirtyRect=old?{x:Math.min(old.x,rect.x),y:Math.min(old.y,rect.y),right:Math.max(old.right,rect.right),bottom:Math.max(old.bottom,rect.bottom)}:rect;this.onChange();
  }
  image(figure) {const e=this.entry(figure);return e.canvas??null;}
  apply(figure,tiles,direction) {
    const e=this.entry(figure);let added=0;
    for(const t of tiles)added+=t[direction].byteLength-(e.tiles.get(`${t.x},${t.y}`)?.pixels.byteLength??0);
    if(this.stats.dirty+added>this.dirtyBudget)throw new Error('Drawing publication is behind. Save or retry encoding before painting more.');
    for(const t of tiles){const pixels=t[direction].slice();e.tiles.set(`${t.x},${t.y}`,{x:t.x,y:t.y,width:t.width,height:t.height,pixels});if(e.pixels)writeTile(e.pixels,e.width,t,pixels);}
    e.revision++;e.failed=null;const d=drawingMetadata(figure);d.revision=e.revision;
    this.present(e);this.schedule();
  }
  checkHistory(command,direction){
    const pending=new Map();const visit=c=>{if(c.commands){for(const child of direction==='before'?[...c.commands].reverse():c.commands)visit(child);}else if(c.kind==='drawing-pixels'){let tiles=pending.get(c.celId);if(!tiles)pending.set(c.celId,tiles=new Map());for(const tile of c.tiles)tiles.set(`${tile.x},${tile.y}`,tile[direction].byteLength);}};visit(command);
    let added=0;for(const [id,tiles] of pending)for(const [key,bytes] of tiles)added+=bytes-(this.entries.get(id)?.tiles.get(key)?.pixels.byteLength??0);
    if(this.stats.dirty+added>this.dirtyBudget)throw new Error('Wait for drawing publication or retry it before undoing.');
  }
  captureClipboard(clipboard){
    const snapshots=new Map();for(const figure of clipboard.figures??[]){if(!drawingMetadata(figure))continue;const e=this.entry(figure);snapshots.set(e.id,{base:e.base,revision:e.revision,tiles:new Map(e.tiles)});}clipboardPixels.set(clipboard,snapshots);
  }
  checkClipboard(forks,clipboard){let bytes=0;const snapshots=clipboardPixels.get(clipboard);for(const [figure] of forks)for(const tile of snapshots?.get(drawingMetadata(figure).celId)?.tiles.values()??[])bytes+=tile.pixels.byteLength;if(this.stats.dirty+bytes>this.dirtyBudget)throw new Error('Wait for drawing publication before pasting.');}
  pasteClipboard(forks,clipboard){const snapshots=clipboardPixels.get(clipboard);for(const [old,copy] of forks){const source=snapshots?.get(drawingMetadata(old).celId);if(source){const e=this.entry(copy);e.base=source.base;e.revision=source.revision;e.tiles=new Map(source.tiles);if(e.tiles.size)this.schedule();}}}
  checkForks(figures){let bytes=0;for(const figure of figures)for(const tile of this.entry(figure).tiles.values())bytes+=tile.pixels.byteLength;if(this.stats.dirty+bytes>this.dirtyBudget)throw new Error('Wait for drawing publication before copying more drawings.');}
  fork(old,copy) {
    const source=this.entry(old),target=this.entry(copy);target.base=source.base;target.revision=source.revision;
    let bytes=0;for(const t of source.tiles.values())bytes+=t.pixels.byteLength;
    if(this.stats.dirty+bytes>this.dirtyBudget)throw new Error('Wait for drawing publication before copying more drawings.');
    target.tiles=new Map(source.tiles);if(target.tiles.size)this.schedule();
  }
  schedule(){if(this.timer||this.encoding||this.disposed)return;this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(this.onError);},80);}
  async flush({signal}={}) {
    if(this.disposed)throw new DOMException('Drawing document closed.','AbortError');
    if(this.encoding){await this.encoding;return this.flush({signal});}
    clearTimeout(this.timer);this.timer=null;
    const e=[...this.entries.values()].find(e=>e.tiles.size&&this.report.figure_types.some(f=>drawingMetadata(f)?.celId===e.id));if(!e)return;
    if(signal?.aborted)throw new DOMException('Drawing publication cancelled.','AbortError');
    const revision=e.revision,generation=this.generation;
    this.encoding=(async()=>{
      const result=await this.worker.request('encode',this.payload(e),{signal});
      if(this.disposed||generation!==this.generation||revision!==e.revision)return;
      const figure=this.report.figure_types.find(f=>drawingMetadata(f)?.celId===e.id);if(!figure)return;
      e.base=result.dataUrl;e.tiles.clear();
      const d=drawingMetadata(figure),asset=figure.image_assets[0];
      // This is derived publication, never a semantic editor edit.
      asset.data_url=result.dataUrl;asset.width=d.width;asset.height=d.height;d.empty=false;d.revision=revision;
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
    for(const [id,e] of this.entries)if(!reachable.has(id)&&!retained.has(id)&&!e.pinned){if(e.canvas)e.canvas.width=e.canvas.height=1;this.entries.delete(id);}
  }
  dispose(){this.disposed=true;this.generation++;clearTimeout(this.timer);this.worker.dispose();this.decodeWorker.dispose();this.thumbnailWorker.dispose();this.thumbnailQueue.clear();for(const t of this.thumbnailCache.values())t.canvas.width=t.canvas.height=1;this.thumbnailCache.clear();for(const job of this.decodeQueue)job.reject(new DOMException('Drawing document closed.','AbortError'));this.decodeQueue=[];for(const e of this.entries.values())if(e.canvas)e.canvas.width=e.canvas.height=1;this.entries.clear();owners.delete(this.report);}
}
