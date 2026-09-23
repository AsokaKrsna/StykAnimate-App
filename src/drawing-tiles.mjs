export const TILE=64;
export const TILE_BYTES=TILE*TILE*4;
export const tileKey=(tx,ty)=>`${tx},${ty}`;
export const parseTileKey=key=>key.split(',').map(Number);

/** Occupied-alpha rect of one tile. Scans inward from each edge and stops at
 * the first opaque sample, so dense tiles cost far less than a full pass. */
function alphaBounds(p){
  const R=TILE*4;let y0=-1,y1=-1,x0=TILE,x1=-1;
  for(let y=0;y<TILE&&y0<0;y++)for(let i=y*R+3,e=i+R;i<e;i+=4)if(p[i]){y0=y;break;}
  if(y0<0)return null;
  for(let y=TILE-1;y>=y0&&y1<0;y--)for(let i=y*R+3,e=i+R;i<e;i+=4)if(p[i]){y1=y;break;}
  for(let y=y0;y<=y1;y++){const row=y*R+3;
    for(let x=0;x<x0;x++)if(p[row+x*4]){x0=x;break;}
    for(let x=TILE-1;x>x1;x--)if(p[row+x*4]){x1=x;break;}}
  return {x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};
}
export function tileTransparent(tile){tile.alphaBounds??=alphaBounds(tile.pixels);return !tile.alphaBounds;}

/** Sparse unbounded pixel surface. Tiles are shared by reference until a
 * writable() or fork() call marks them frozen, after which mutation copies. */
export class TileStore {
  constructor(tiles=new Map()){this.tiles=tiles;this._bounds=undefined;this._tileBounds=undefined;}
  get(tx,ty){return this.tiles.get(tileKey(tx,ty));}
  has(tx,ty){return this.tiles.has(tileKey(tx,ty));}
  get size(){return this.tiles.size;}
  get bytes(){let bytes=0;for(const tile of this.tiles.values())bytes+=tile.pixels.byteLength;return bytes;}
  keys(){return this.tiles.keys();}
  values(){return this.tiles.values();}
  [Symbol.iterator](){return this.tiles.values();}
  _changed(){this._bounds=undefined;this._tileBounds=undefined;}
  /** Keep cached bounds current when `old` (or nothing) is replaced by
   * `tile` (or nothing), so painting a large drawing never rescans every tile.
   * Coverage only grows on insert. Alpha bounds merge the new tile's alpha
   * rect, and only rescan lazily when the replaced tile touched their edge. */
  _placed(old,tile){
    const t=this._tileBounds;
    if(!old&&tile&&t!==undefined){const x=tile.tx*TILE,y=tile.ty*TILE;if(t===null)this._tileBounds={x,y,width:TILE,height:TILE};else{const x0=Math.min(t.x,x),y0=Math.min(t.y,y);this._tileBounds={x:x0,y:y0,width:Math.max(t.x+t.width,x+TILE)-x0,height:Math.max(t.y+t.height,y+TILE)-y0};}}
    else if(old&&!tile)this._tileBounds=undefined;
    const b=this._bounds;if(b===undefined)return;
    if(old){old.alphaBounds??=alphaBounds(old.pixels);const a=old.alphaBounds;
      if(a&&b){const x=old.tx*TILE+a.x,y=old.ty*TILE+a.y;if(x<=b.x||y<=b.y||x+a.width>=b.x+b.width||y+a.height>=b.y+b.height){this._bounds=undefined;return;}}}
    if(!tile)return;
    tile.alphaBounds??=alphaBounds(tile.pixels);const a=tile.alphaBounds;if(!a)return;
    const x=tile.tx*TILE+a.x,y=tile.ty*TILE+a.y;
    if(b===null){this._bounds={x,y,width:a.width,height:a.height};return;}
    const x0=Math.min(b.x,x),y0=Math.min(b.y,y);this._bounds={x:x0,y:y0,width:Math.max(b.x+b.width,x+a.width)-x0,height:Math.max(b.y+b.height,y+a.height)-y0};
  }
  writable(tx,ty,{create=true}={}) {
    const key=tileKey(tx,ty);let tile=this.tiles.get(key);
    if(!tile){if(!create)return null;tile={tx,ty,pixels:new Uint8ClampedArray(TILE_BYTES),frozen:false};this.tiles.set(key,tile);this._placed(null,tile);this._bounds=undefined;return tile;}
    if(tile.frozen){tile={tx,ty,pixels:tile.pixels.slice(),frozen:false};this.tiles.set(key,tile);}
    tile.png=undefined;tile.alphaBounds=undefined;this._bounds=undefined;return tile;
  }
  set(tx,ty,pixels) {
    const key=tileKey(tx,ty);
    if(pixels==null){this.delete(tx,ty);return;}
    let full;
    if(pixels.byteLength===4){full=new Uint8ClampedArray(TILE_BYTES);const word=new Uint32Array(Uint8Array.from(pixels).buffer)[0];new Uint32Array(full.buffer).fill(word);}
    else{full=new Uint8ClampedArray(pixels);if(full.byteLength!==TILE_BYTES)throw new Error('Tile pixels must be 4 uniform bytes or one full tile.');}
    const old=this.tiles.get(key),tile={tx,ty,pixels:full,frozen:false};this.tiles.set(key,tile);this._placed(old,tile);
  }
  /** Take ownership of a full tile buffer without copying it; the caller must
   * not retain or mutate `pixels` afterwards. */
  adopt(tx,ty,pixels){
    if(!(pixels instanceof Uint8ClampedArray)||pixels.byteLength!==TILE_BYTES)throw new Error('Tile pixels must be one full tile.');
    const key=tileKey(tx,ty),old=this.tiles.get(key),tile={tx,ty,pixels,frozen:false};this.tiles.set(key,tile);this._placed(old,tile);
  }
  delete(tx,ty){const key=tileKey(tx,ty),old=this.tiles.get(key);if(!old)return;this.tiles.delete(key);this._placed(old,null);}
  fork(){for(const tile of this.tiles.values())tile.frozen=true;return new TileStore(new Map(this.tiles));}
  freeze(){for(const tile of this.tiles.values())tile.frozen=true;}
  get bounds() {
    if(this._bounds!==undefined)return this._bounds;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const tile of this.tiles.values()){
      tile.alphaBounds??=alphaBounds(tile.pixels);if(!tile.alphaBounds)continue;
      const x=tile.tx*TILE+tile.alphaBounds.x,y=tile.ty*TILE+tile.alphaBounds.y;
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+tile.alphaBounds.width);y1=Math.max(y1,y+tile.alphaBounds.height);
    }
    return this._bounds=Number.isFinite(x0)?{x:x0,y:y0,width:x1-x0,height:y1-y0}:null;
  }
  /** Tile-aligned coverage: the rect exactly containing every present tile.
   * Unlike `bounds` it is unaffected by alpha and never crops a tile. */
  get tileBounds() {
    if(this._tileBounds!==undefined)return this._tileBounds;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const tile of this.tiles.values()){x0=Math.min(x0,tile.tx);y0=Math.min(y0,tile.ty);x1=Math.max(x1,tile.tx);y1=Math.max(y1,tile.ty);}
    return this._tileBounds=Number.isFinite(x0)?{x:x0*TILE,y:y0*TILE,width:(x1-x0+1)*TILE,height:(y1-y0+1)*TILE}:null;
  }
  readRect(x,y,width,height) {
    const out=new Uint8ClampedArray(width*height*4);
    for(const [tx,ty] of TileStore.tilesInRect(x,y,width,height)){
      const tile=this.get(tx,ty);if(!tile)continue;
      const ox=tx*TILE,oy=ty*TILE,sx=Math.max(0,x-ox),ex=Math.min(TILE,x+width-ox);
      if(sx>=ex)continue;
      for(let py=Math.max(0,y-oy);py<Math.min(TILE,y+height-oy);py++)out.set(tile.pixels.subarray((py*TILE+sx)*4,(py*TILE+ex)*4),((py+oy-y)*width+sx+ox-x)*4);
    }
    return out;
  }
  writeRect(x,y,width,height,pixels) {
    for(const [tx,ty] of TileStore.tilesInRect(x,y,width,height)){
      const tile=this.writable(tx,ty),ox=tx*TILE,oy=ty*TILE,sx=Math.max(0,x-ox),ex=Math.min(TILE,x+width-ox);
      if(sx>=ex)continue;
      for(let py=Math.max(0,y-oy);py<Math.min(TILE,y+height-oy);py++)tile.pixels.set(pixels.subarray(((py+oy-y)*width+sx+ox-x)*4,((py+oy-y)*width+ex+ox-x)*4),(py*TILE+sx)*4);
    }
  }
  pixel(x,y) {
    const tile=this.get(Math.floor(x/TILE),Math.floor(y/TILE));
    if(!tile)return[0,0,0,0];
    const i=((y-tile.ty*TILE)*TILE+(x-tile.tx*TILE))*4;return[tile.pixels[i],tile.pixels[i+1],tile.pixels[i+2],tile.pixels[i+3]];
  }
  prune(){const removed=[];for(const [key,tile] of this.tiles)if(tileTransparent(tile)){this.tiles.delete(key);removed.push(key);}if(removed.length)this._changed();return removed;}
  static tilesInRect(x,y,width,height) {
    if(width<=0||height<=0)return[];
    const out=[],x1=Math.floor((x+width-1)/TILE),y1=Math.floor((y+height-1)/TILE);
    for(let ty=Math.floor(y/TILE);ty<=y1;ty++)for(let tx=Math.floor(x/TILE);tx<=x1;tx++)out.push([tx,ty]);
    return out;
  }
}
