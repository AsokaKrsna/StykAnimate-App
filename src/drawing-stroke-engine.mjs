import {DrawingStroke} from './drawing-pixels.mjs';
import {TileStore,TILE,tileKey,parseTileKey} from './drawing-tiles.mjs';

/** In-process stroke engine shared by the stroke worker and Node tests. Each
 * stroke rasterizes into a private TileStore seeded once per tile by the main
 * thread; `before` is therefore the state the stroke first saw, which is the
 * undo record's before side. Batches are processed strictly in seq order. */
export class StrokeEngine {
  constructor(){this.strokes=new Map();}
  begin(id,settings){
    this.strokes.delete(id);
    const store=new TileStore();
    this.strokes.set(id,{store,brush:new DrawingStroke(store,settings),seq:0});
  }
  samples(id,seq,samples,tiles){
    const s=this.strokes.get(id);if(!s||seq<=s.seq)return null;
    s.seq=seq;
    if(s.store.bytes+(tiles?.length??0)*TILE*TILE*4>s.brush.workingBytes/2)throw new Error('The stroke exceeds the drawing working memory limit.');
    for(const t of tiles??[])if(!s.store.has(t.tx,t.ty)&&t.pixels)s.store.set(t.tx,t.ty,new Uint8ClampedArray(t.pixels));
    for(const p of samples??[])s.brush.sample(p);
    const changed=[];
    for(const key of s.brush.dirtyTiles){const [tx,ty]=parseTileKey(key),tile=s.store.get(tx,ty);if(tile)changed.push({tx,ty,pixels:tile.pixels.slice().buffer});}
    s.brush.dirtyTiles.clear();
    let dirty=null;
    for(const t of changed)dirty=dirty?{x:Math.min(dirty.x,t.tx*TILE),y:Math.min(dirty.y,t.ty*TILE),width:Math.max(dirty.x+dirty.width,t.tx*TILE+TILE)-Math.min(dirty.x,t.tx*TILE),height:Math.max(dirty.y+dirty.height,t.ty*TILE+TILE)-Math.min(dirty.y,t.ty*TILE)}:{x:t.tx*TILE,y:t.ty*TILE,width:TILE,height:TILE};
    return {tiles:changed,dirty};
  }
  end(id){
    const s=this.strokes.get(id);if(!s)return null;
    this.strokes.delete(id);
    return s.brush.finish();
  }
  cancel(id){this.strokes.delete(id);}
}
