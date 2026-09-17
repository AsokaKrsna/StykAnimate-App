import {TILE,TILE_BYTES,tileTransparent,TileStore} from './drawing-tiles.mjs';
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
