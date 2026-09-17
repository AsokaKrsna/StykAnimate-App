import {drawingMetadata} from './drawing-model.mjs';
import {decodeTileBlob,tileStoreFromList} from './drawing-tile-codec.mjs';
import {presenterScratch,levelStore} from './drawing-raster.mjs';

/** Worker/main-thread tile decoder for published v2 drawing cels. Decoded
 * stores are immutable snapshots keyed by celId+revision, kept in a bounded
 * LRU so playback, export, thumbnail and preview paths all read the same
 * authoritative tiles through `paintDrawingTiles`. */
export class DrawingTileProvider {
  constructor({budgetBytes=96*1024*1024}={}) {
    Object.assign(this,{budgetBytes,entries:new Map(),bytes:0,clock:0});
  }
  /** Sync presenter lookup: {id,store,stamp,dirty:null,scratch,level} or null. */
  presenter(figure) {
    const e=this.entries.get(drawingMetadata(figure)?.celId);
    return e?.store?e:null;
  }
  /** Decode styk_tiles blobs into tile stores. v1 cels keep the PNG path. */
  async prepare(figures) {
    // Collect every cel this draw needs before evicting: the budget is a
    // retention target and must never remove what the current draw reads.
    const needed=new Set();
    for(const figure of figures??[]){const d=drawingMetadata(figure);if(d?.version===2)needed.add(d.celId);}
    for(const figure of figures??[]){
      const d=drawingMetadata(figure);
      if(!d||d.version!==2)continue;
      let e=this.entries.get(d.celId);
      if(e&&e.revision===d.revision){this.entries.delete(d.celId);this.entries.set(d.celId,e);continue;}
      const url=figure.image_assets?.[0]?.styk_tiles;
      const store=tileStoreFromList(url?await decodeTileBlob(url):[]);
      if(e)this.bytes-=e.bytes;
      e={id:d.celId,revision:d.revision,store,bytes:store.bytes,stamp:1,dirty:null,levels:null,levelsUsed:0};
      e.scratch=(rect,options)=>presenterScratch(e,rect,options);
      e.level=k=>{e.levelsUsed=++this.clock;return levelStore(e,k);};
      this.entries.set(d.celId,e);this.bytes+=e.bytes;
    }
    for(const [id,old] of this.entries){if(this.bytes<=this.budgetBytes)break;if(needed.has(id))continue;this.entries.delete(id);this.bytes-=old.bytes;}
  }
  dispose(){this.entries.clear();this.bytes=0;}
}
