import {TILE,TILE_BYTES,tileTransparent,TileStore,tileKey,parseTileKey} from './drawing-tiles.mjs';
import {encodePNGPortable} from './sticknodes/decoder/png-browser.mjs';
import {decodeDrawingPNGBytes} from './drawing-png.mjs';
export const TILE_BLOB_PREFIX='data:application/x-styk-tiles;base64,';
const TILE_BLOB_MAX_BYTES=96*1024*1024,TILE_BLOB_MAX_TILES=65536,TILE_BLOB_MAX_PIXELS=512*1024*1024;
export function tileBlobBytes(url){if(typeof url!=='string'||!url.startsWith(TILE_BLOB_PREFIX))throw new Error('Drawing tiles need an embedded tile blob.');const bytes=Uint8Array.from(atob(url.slice(TILE_BLOB_PREFIX.length)),c=>c.charCodeAt(0));if(bytes.length>TILE_BLOB_MAX_BYTES)throw new Error('Drawing tile blob exceeds its size bound.');return bytes;}
/** Assemble the blob bytes from already-encoded per-tile PNGs. */
export function assembleTileBlobBytes(tiles){
  const head=16+12*tiles.length,total=tiles.reduce((n,t)=>n+t.png.length,head),out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,0x54595453);view.setUint32(4,1,true);view.setUint32(8,TILE,true);view.setUint32(12,tiles.length,true);let offset=16;
  for(const tile of tiles){view.setInt32(offset,tile.tx,true);view.setInt32(offset+4,tile.ty,true);view.setUint32(offset+8,tile.png.length,true);offset+=12;out.set(tile.png,offset);offset+=tile.png.length;}
  return out;
}
export async function encodeTileBlob(store){
  const tiles=[];
  for(const tile of store){if(tileTransparent(tile))continue;if(!tile.png)tile.png=await encodePNGPortable({width:TILE,height:TILE,channels:4},tile.pixels);tiles.push(tile);}
  const bytes=assembleTileBlobBytes(tiles);let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return TILE_BLOB_PREFIX+btoa(text);
}
export async function decodeTileBlob(url){
  const bytes=tileBlobBytes(url),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<16||view.getUint32(0)!==0x54595453||view.getUint32(4,true)!==1||view.getUint32(8,true)!==TILE)throw new Error('Invalid drawing tile blob.');
  const count=view.getUint32(12,true);if(count>TILE_BLOB_MAX_TILES)throw new Error('Drawing tile blob exceeds its tile bound.');
  const tiles=[];let offset=16,decoded=0;
  for(let i=0;i<count;i++){
    if(offset+12>bytes.length)throw new Error('Truncated drawing tile blob.');
    const tx=view.getInt32(offset,true),ty=view.getInt32(offset+4,true),length=view.getUint32(offset+8,true);offset+=12;
    if(offset+length>bytes.length||length>TILE_BLOB_MAX_BYTES)throw new Error('Truncated drawing tile blob.');
    const tile=await decodeDrawingPNGBytes(bytes.subarray(offset,offset+length));offset+=length;
    if(tile.width!==TILE||tile.height!==TILE)throw new Error('Drawing tile blob carries a non-tile image.');
    decoded+=tile.pixels.byteLength;if(decoded>TILE_BLOB_MAX_PIXELS)throw new Error('Drawing tile blob expands beyond its pixel bound.');
    tiles.push({tx,ty,pixels:tile.pixels,png:bytes.slice(offset-length,offset)});
  }
  if(offset!==bytes.length)throw new Error('Drawing tile blob has trailing bytes.');
  return tiles;
}
export function tileStoreFromList(tiles){const store=new TileStore();for(const tile of tiles)store.tiles.set(`${tile.tx},${tile.ty}`,{tx:tile.tx,ty:tile.ty,pixels:new Uint8ClampedArray(tile.pixels),frozen:false,png:tile.png});return store;}

/** Per-cel encoded-tile cache owned by the pixel worker. Publication sends
 * only tiles whose PNG the main thread no longer trusts plus the ordered key
 * list the blob must carry; cached PNGs assemble unchanged tiles. `stamp` is
 * the cache's recency clock for LRU eviction across all cels. */
export class TileEncodeCache {
  constructor({maxBytes=64*1024*1024}={}){this.cels=new Map();this.bytes=0;this.clock=0;this.maxBytes=maxBytes;}
  cel(id){let cel=this.cels.get(id);if(!cel)this.cels.set(id,cel=new Map());else{this.cels.delete(id);this.cels.set(id,cel);}return cel;}
  /** Encode tiles into a cel's cache without pruning or assembling a blob, so
   * a large publication can stream its pixels in bounded chunks. */
  async prime(celId,tiles){
    const cel=this.cel(celId),encoded=[];
    for(const tile of tiles){
      const png=new Uint8Array(await encodePNGPortable({width:TILE,height:TILE,channels:4},new Uint8ClampedArray(tile.pixels))),key=tileKey(tile.tx,tile.ty),old=cel.get(key);
      if(old)this.bytes-=old.png.length;cel.set(key,{png,stamp:++this.clock});this.bytes+=png.length;encoded.push({tx:tile.tx,ty:tile.ty,png});
    }
    return encoded;
  }
  /** keep lists every tile key this publication carries, in blob order; tiles
   * are the changed ones to encode. Returns {missing} when a kept key lacks a
   * cached PNG so the caller can resend those pixels once. */
  async encode(celId,keep,tiles){
    const cel=this.cel(celId),wanted=new Set(keep),encoded=[];
    for(const key of [...cel.keys()])if(!wanted.has(key)){this.bytes-=cel.get(key).png.length;cel.delete(key);}
    for(const tile of tiles){
      const png=new Uint8Array(await encodePNGPortable({width:TILE,height:TILE,channels:4},new Uint8ClampedArray(tile.pixels))),key=tileKey(tile.tx,tile.ty),old=cel.get(key);
      if(old)this.bytes-=old.png.length;cel.set(key,{png,stamp:++this.clock});this.bytes+=png.length;encoded.push({tx:tile.tx,ty:tile.ty,png});
    }
    // Bound the cache globally, oldest cel entries first, but never drop a key
    // this publication still needs.
    for(const [id,entries] of this.cels){
      if(this.bytes<=this.maxBytes)break;
      for(const [key,entry] of entries){if(this.bytes<=this.maxBytes)break;if(id===celId&&wanted.has(key))continue;this.bytes-=entry.png.length;entries.delete(key);}
      if(!entries.size)this.cels.delete(id);
    }
    const assembly=[],missing=[];
    for(const key of keep){const hit=cel.get(key);if(!hit){missing.push(key);continue;}const [tx,ty]=parseTileKey(key);assembly.push({tx,ty,png:hit.png});}
    if(missing.length)return{missing};
    return{tiles:encoded,bytes:assembleTileBlobBytes(assembly),encoded:encoded.length,reused:keep.length-encoded.length};
  }
}
