import {TILE,tileKey} from './drawing-tiles.mjs';

/** A bounded derived-image cache. Dense viewport rasterization belongs to a
 * dedicated worker, never the input thread. Old completed images remain
 * usable while a new revision is prepared; stale replies are disposed. */
export class DrawingPreviewCache {
  constructor(worker,{budgetBytes=64*1024*1024,onReady=()=>{},onError=()=>{},reserve=()=>true,hold=()=>{}}={}){
    Object.assign(this,{worker,budgetBytes,onReady,onError,reserve,hold,cache:new Map(),queue:new Map(),bytes:0});
  }
  scratch(entry,rect,{level=0,maxSide=4096,clamp=false}={}){
    const b=entry.store?.tileBounds,f=2**level;if(!b||!rect||rect.width<=0||rect.height<=0)return null;
    maxSide=Math.min(maxSide,4096,Math.floor(Math.sqrt(this.budgetBytes/4)/TILE)*TILE);if(maxSide<TILE)return null;
    let x=Math.max(Math.floor(b.x/f/TILE)*TILE,Math.floor(rect.x/f/TILE)*TILE-TILE),y=Math.max(Math.floor(b.y/f/TILE)*TILE,Math.floor(rect.y/f/TILE)*TILE-TILE);
    let right=Math.min(Math.ceil((b.x+b.width)/f/TILE)*TILE,Math.ceil((rect.x+rect.width)/f/TILE)*TILE+TILE),bottom=Math.min(Math.ceil((b.y+b.height)/f/TILE)*TILE,Math.ceil((rect.y+rect.height)/f/TILE)*TILE+TILE);
    if(right<=x||bottom<=y)return null;
    if(right-x>maxSide||bottom-y>maxSide){if(!clamp)return null;x=Math.max(x,Math.min(right-maxSide,Math.floor((rect.x+rect.width/2)/f-maxSide/2)));y=Math.max(y,Math.min(bottom-maxSide,Math.floor((rect.y+rect.height/2)/f-maxSide/2)));right=Math.min(right,x+maxSide);bottom=Math.min(bottom,y+maxSide);}
    const width=right-x,height=bottom-y,anchorKey=`worker:${level}:${x},${y},${width},${height}`,key=entry.id+'|'+anchorKey,version=entry.pixelStamp??0,hit=this.cache.get(key);
    if(entry.previewError?.store===entry.store&&entry.previewError.version===version)return null;
    if(hit){this.cache.delete(key);this.cache.set(key,hit);}
    if(hit?.version!==version||hit?.store!==entry.store){
      // One request per cel per render: the renderer's higher-level retries
      // must not replace the desired sampling density with level eight.
      if(!this.queue.has(entry.id)&&this.active?.entry!==entry){
        if(this.queue.size>=3)this.queue.delete(this.queue.keys().next().value);
        this.queue.set(entry.id,{entry,store:entry.store,version,key,anchorKey,x,y,width,height,level,scale:f});this.pump();
      }
    }
    return hit?{...hit,stamp:entry.stamp,dirty:null}:null;
  }
  async pump(){
    if(this.active||this.disposed||!this.queue.size)return;
    const [id,job]=this.queue.entries().next().value;this.queue.delete(id);this.active=job;
    const current=()=>!this.disposed&&!job.entry.disposed&&job.entry.store===job.store&&(job.entry.pixelStamp??0)===job.version;
    try{
      const tiles=[],x=job.x*job.scale,y=job.y*job.scale,right=(job.x+job.width)*job.scale,bottom=(job.y+job.height)*job.scale;
      const source=[...job.store].filter(t=>t.tx*TILE<right&&(t.tx+1)*TILE>x&&t.ty*TILE<bottom&&(t.ty+1)*TILE>y);
      this.entry=job.entry;this.hold(this,Math.ceil(source.length*TILE*TILE*4*1.34)+job.width*job.height*8);
      const cached=this.source?.entry===job.entry&&this.source?.storeRef.deref()===job.store?this.source:null,versions=new Map();
      for(const t of source){
        if(t.tx*TILE>=right||(t.tx+1)*TILE<=x||t.ty*TILE>=bottom||(t.ty+1)*TILE<=y)continue;
        const key=tileKey(t.tx,t.ty),version=t.version??0;versions.set(key,version);if(cached?.versions.get(key)===version)continue;
        tiles.push({tx:t.tx,ty:t.ty,pixels:t.pixels.slice().buffer});
        if(tiles.length%128===0){await new Promise(resolve=>setTimeout(resolve,0));if(!current())return;}
      }
      if(!current())return;
      const result=await this.worker.request('preview',{tiles,reset:!cached,keep:[...versions.keys()],rect:{x:job.x,y:job.y,width:job.width,height:job.height},level:job.level},{transfer:tiles.map(t=>t.pixels)});
      this.source={entry:job.entry,storeRef:new WeakRef(job.store),versions};this.lastTransferredTiles=tiles.length;
      if(!current()){result.bitmap.close();return;}
      this.remove(job.key);const bytes=job.width*job.height*4;
      if(!this.reserve(bytes)){result.bitmap.close();throw new Error('Drawing preview memory is full.');}
      for(const key of this.cache.keys()){if(this.bytes+bytes<=this.budgetBytes)break;this.remove(key);}
      this.cache.set(job.key,{canvas:result.bitmap,bytes,version:job.version,store:job.store,id,anchorKey:job.anchorKey,x:job.x,y:job.y,width:job.width,height:job.height,level:job.level,scale:job.scale});this.bytes+=bytes;
      job.entry.stamp++;this.onReady();
    }catch(error){this.source=null;this.hold(this,0);if(!this.disposed&&error.name!=='AbortError'){job.entry.previewError={store:job.store,version:job.version};this.onError(error);}}
    finally{this.active=null;this.pump();if(!this.disposed&&!current()){job.entry.stamp++;this.onReady();}}
  }
  remove(key){const value=this.cache.get(key);if(!value)return;value.canvas.close();this.bytes-=value.bytes;this.cache.delete(key);}
  drop(entry){this.queue.delete(entry.id);for(const [key,value] of this.cache)if(value.id===entry.id)this.remove(key);if(this.active?.entry===entry||this.source?.entry===entry){this.worker.dispose();this.source=null;this.hold(this,0);}}
  dispose(){this.disposed=true;this.queue.clear();this.worker.dispose();this.source=null;this.hold(this,0);for(const key of this.cache.keys())this.remove(key);}
}
