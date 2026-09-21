export const TILE=64;
export const TILE_BYTES=TILE*TILE*4;
export const MIN_TILE=-0x80000000,MAX_TILE=0x7fffffff;
export function assertTileCoordinates(tx,ty){if(!Number.isInteger(tx)||!Number.isInteger(ty)||tx<MIN_TILE||ty<MIN_TILE||tx>MAX_TILE||ty>MAX_TILE)throw new Error('Drawing coordinates exceed the file format range.');}
export const tileKey=(tx,ty)=>`${tx},${ty}`;
export const parseTileKey=key=>key.split(',').map(Number);
let tileVersion=0;

function alphaBounds(pixels){
  let x0=TILE,y0=0,x1=-1,y1=TILE-1;
  const first=(y,left=0,right=TILE-1)=>{for(let x=left;x<=right;x++)if(pixels[(y*TILE+x)*4+3])return x;return -1;};
  const last=(y,left=0,right=TILE-1)=>{for(let x=right;x>=left;x--)if(pixels[(y*TILE+x)*4+3])return x;return -1;};
  // The outside rows establish vertical bounds. Interior rows only need to
  // extend the horizontal bounds; once both edges are occupied we are done.
  for(;y0<TILE;y0++){x0=first(y0);if(x0>=0)break;}
  if(y0===TILE)return null;
  x1=last(y0,x0);
  for(;y1>y0;y1--){const x=first(y1);if(x<0)continue;x0=Math.min(x0,x);x1=Math.max(x1,last(y1,x));break;}
  for(let y=y0+1;y<y1&&(x0>0||x1<TILE-1);y++){
    const left=first(y,0,x0-1);if(left>=0)x0=left;
    const right=last(y,x1+1);if(right>=0)x1=right;
  }
  return{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};
}
export function tileTransparent(tile){if(tile.alphaBounds===undefined)tile.alphaBounds=alphaBounds(tile.pixels);return !tile.alphaBounds;}

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
  _changed(){this._bounds=undefined;this._tileBounds=undefined;this.revision=(this.revision??0)+1;}
  writable(tx,ty,{create=true}={}) {
    assertTileCoordinates(tx,ty);
    const key=tileKey(tx,ty);let tile=this.tiles.get(key);
    if(!tile){if(!create)return null;tile={tx,ty,pixels:new Uint8ClampedArray(TILE_BYTES),frozen:false,version:++tileVersion};this.tiles.set(key,tile);this._changed();return tile;}
    if(tile.frozen){tile={tx,ty,pixels:tile.pixels.slice(),frozen:false};this.tiles.set(key,tile);}
    tile.version=++tileVersion;tile.png=undefined;tile.alphaBounds=undefined;this._changed();return tile;
  }
  set(tx,ty,pixels) {
    assertTileCoordinates(tx,ty);
    const key=tileKey(tx,ty);
    if(pixels==null){if(this.tiles.delete(key))this._changed();return;}
    let full;
    if(pixels.byteLength===4){full=new Uint8ClampedArray(TILE_BYTES);const word=new Uint32Array(Uint8Array.from(pixels).buffer)[0];new Uint32Array(full.buffer).fill(word);}
    else{full=new Uint8ClampedArray(pixels);if(full.byteLength!==TILE_BYTES)throw new Error('Tile pixels must be 4 uniform bytes or one full tile.');}
    this.adopt(tx,ty,full);
  }
  /** Take ownership of a full tile. Callers must stop mutating the buffer;
   * subsequent writes use writable() so forks remain copy-on-write. */
  adopt(tx,ty,pixels,alphaBounds){
    assertTileCoordinates(tx,ty);
    if(!(pixels instanceof Uint8ClampedArray)||pixels.byteLength!==TILE_BYTES)throw new Error('Owned tile pixels must be one full tile.');
    this.tiles.set(tileKey(tx,ty),{tx,ty,pixels,alphaBounds,frozen:false,version:++tileVersion});this._changed();
  }
  delete(tx,ty){if(this.tiles.delete(tileKey(tx,ty)))this._changed();}
  fork(){for(const tile of this.tiles.values())tile.frozen=true;return new TileStore(new Map(this.tiles));}
  freeze(){for(const tile of this.tiles.values())tile.frozen=true;}
  get bounds() {
    if(this._bounds!==undefined)return this._bounds;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const tile of this.tiles.values()){
      if(tileTransparent(tile))continue;
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
