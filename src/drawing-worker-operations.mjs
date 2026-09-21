import {TILE,TILE_BYTES,tileKey,TileStore,tileTransparent} from './drawing-tiles.mjs';
import {tileChanges} from './drawing-pixels.mjs';
import {floodTiles} from './drawing-fill.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {decodeDrawingPNG} from './drawing-png.mjs';
import {encodeClipboardTiles,decodePixelClipboard} from './drawing-clipboard.mjs';
import {decodeTileBlob,tileStoreFromList,TILE_BLOB_PREFIX,TileEncodeCache} from './drawing-tile-codec.mjs';
import {levelStore,invalidateLevels} from './drawing-raster.mjs';
import {transformSelectedPixels} from './drawing-selection.mjs';
import {captureSelection} from './drawing-lasso.mjs';
import {transformTiles,TRANSFORM_BYTES} from './drawing-transform.mjs';

const storeOf=data=>{const store=new TileStore();for(const t of data.tiles??[])store.tiles.set(tileKey(t.tx,t.ty),{tx:t.tx,ty:t.ty,pixels:new Uint8ClampedArray(t.pixels),alphaBounds:t.alphaBounds,frozen:false,png:t.png?new Uint8Array(t.png):undefined});return store;};
const changesReply=(id,store,before)=>{const tiles=tileChanges(store,before);self.postMessage({id,tiles},tiles.flatMap(t=>[t.before?.buffer,t.after?.buffer].filter(Boolean)));};
const validRect=r=>r&&[r.x,r.y].every(Number.isSafeInteger)&&Number.isInteger(r.width)&&Number.isInteger(r.height)&&r.width>0&&r.height>0&&r.width*r.height<=DRAWING_MAX_PIXELS;
// Encoded tiles persist across publications so a re-publish only encodes
// tiles the main thread resent; the blob is assembled here, never upstream.
const encodeCache=new TileEncodeCache();
let previewStore=null;
/** The smallest mip level whose bounds still span ~64 output pixels. */
const thumbnailLevel=bounds=>bounds?Math.max(0,Math.min(4,Math.floor(Math.log2(Math.max(bounds.width,bounds.height)/64)))):0;

export async function drawingWorkerOperation(data){
  const {id,kind}=data;
  try {
    if(kind==='decode-legacy'){
      const crop=data.crop??{x:0,y:0},image=await decodeDrawingPNG(data.url),tiles=[];
      if(![crop.x,crop.y].every(Number.isInteger))throw new Error('Invalid drawing crop.');
      for(const [tx,ty] of TileStore.tilesInRect(crop.x,crop.y,image.width,image.height)){
        const pixels=new Uint8ClampedArray(TILE_BYTES),ox=tx*TILE-crop.x,oy=ty*TILE-crop.y;
        for(let py=Math.max(0,-oy);py<Math.min(TILE,image.height-oy);py++)
          pixels.set(image.pixels.subarray(((py+oy)*image.width+Math.max(0,ox))*4,((py+oy)*image.width+Math.min(image.width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);
        const tile={tx,ty,pixels,frozen:false};if(!tileTransparent(tile))tiles.push({tx,ty,pixels:pixels.buffer});
      }
      self.postMessage({id,tiles},tiles.map(t=>t.pixels));return;
    }
    if(kind==='decode-tiles'){
      const tiles=(await decodeTileBlob(data.url)).map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.buffer,png:t.png.buffer}));
      self.postMessage({id,tiles},tiles.flatMap(t=>[t.pixels,t.png]));return;
    }
    if(kind==='encode-tiles'){
      const result=await encodeCache.encode(data.celId,data.keep??null,data.tiles??[],{partial:data.partial});
      const out=result.tiles.map(t=>({tx:t.tx,ty:t.ty,png:t.png.slice().buffer}));
      if(result.missing){self.postMessage({id,missing:result.missing,tiles:out,encoded:result.encoded},out.map(t=>t.png));return;}
      if(data.partial){self.postMessage({id,tiles:out,encoded:result.encoded},out.map(t=>t.png));return;}
      let text='';for(let i=0;i<result.bytes.length;i+=16384)text+=String.fromCharCode(...result.bytes.subarray(i,i+16384));
      self.postMessage({id,tiles:out,blobUrl:TILE_BLOB_PREFIX+btoa(text),encoded:result.encoded,reused:result.reused},out.map(t=>t.png));return;
    }
    if(kind==='fill'){
      const store=storeOf(data),tiles=floodTiles(store,{...data.options,bounds:data.bounds,source:data.source?new Uint8ClampedArray(data.source):undefined});
      self.postMessage({id,tiles},tiles.flatMap(t=>[t.before?.buffer,t.after?.buffer].filter(Boolean)));return;
    }
    if(kind==='select'){
      const result=captureSelection(storeOf(data),data.points,{maxBytes:data.maxBytes});
      const tiles=result.tiles.map(t=>({...t,pixels:t.full?null:t.pixels.buffer,remaining:t.remaining?.buffer??null}));
      self.postMessage({id,tiles},tiles.flatMap(t=>[t.pixels,t.remaining].filter(Boolean)));return;
    }
    if(kind==='copy-selection'){
      const tiles=await encodeClipboardTiles(data.tiles,{maxBytes:data.maxBytes});self.postMessage({id,tiles});return;
    }
    if(kind==='selection'){
      const store=storeOf(data),source=storeOf(data.selection),tiles=transformSelectedPixels(store,{...data.selection,source});
      self.postMessage({id,tiles},tiles.flatMap(t=>[t.before?.buffer,t.after?.buffer].filter(Boolean)));return;
    }
    if(kind==='paste'){
      const store=storeOf(data),before=new Map(),maxBytes=data.maxBytes??TRANSFORM_BYTES;
      const {store:source,encodedBytes}=await decodePixelClipboard(data.clip,{maxBytes:maxBytes-store.bytes});
      transformTiles(source,data.matrix,{target:store,before,filter:data.filter,maxBytes:maxBytes-encodedBytes});
      changesReply(id,store,before);return;
    }
    if(kind==='resample'){
      const ratio=data.ratio;
      if(!Number.isFinite(ratio)||ratio<=0)throw new Error('Invalid drawing resample.');
      const out=transformTiles(storeOf(data),[ratio,0,0,ratio,0,0],{filter:data.filter,maxBytes:data.maxBytes});
      const bounds=out.bounds,tiles=[...out].map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.buffer,alphaBounds:t.alphaBounds}));
      self.postMessage({id,tiles,bounds},tiles.map(t=>t.pixels));return;
    }
    if(kind==='preview'){
      const {rect,level}=data;
      if(!validRect(rect)||rect.width>4096||rect.height>4096||!Number.isInteger(level)||level<0||level>8)throw new Error('Invalid drawing preview bounds.');
      if(data.reset||!previewStore)previewStore={store:new TileStore()};
      const keep=new Set(data.keep),input=previewStore.store;
      for(const tile of input)if(!keep.has(tileKey(tile.tx,tile.ty))){input.delete(tile.tx,tile.ty);invalidateLevels(previewStore,{x:tile.tx*TILE,y:tile.ty*TILE,width:TILE,height:TILE});}
      for(const tile of data.tiles){input.tiles.set(tileKey(tile.tx,tile.ty),{tx:tile.tx,ty:tile.ty,pixels:new Uint8ClampedArray(tile.pixels)});input._changed();invalidateLevels(previewStore,{x:tile.tx*TILE,y:tile.ty*TILE,width:TILE,height:TILE});}
      const store=levelStore(previewStore,level),canvas=new OffscreenCanvas(rect.width,rect.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
      for(const tile of store)ctx.putImageData(new ImageData(tile.pixels,TILE,TILE),tile.tx*TILE-rect.x,tile.ty*TILE-rect.y);
      const bitmap=canvas.transferToImageBitmap();self.postMessage({id,bitmap},[bitmap]);return;
    }
    if(kind==='thumbnail'){
      let store;
      if(data.legacy){const image=await decodeDrawingPNG(data.legacy.url),crop=data.legacy.crop??{x:0,y:0};store=new TileStore();
        for(const [tx,ty] of TileStore.tilesInRect(crop.x,crop.y,image.width,image.height)){const pixels=new Uint8ClampedArray(TILE_BYTES),ox=tx*TILE-crop.x,oy=ty*TILE-crop.y;
          for(let py=Math.max(0,-oy);py<Math.min(TILE,image.height-oy);py++)pixels.set(image.pixels.subarray(((py+oy)*image.width+Math.max(0,ox))*4,((py+oy)*image.width+Math.min(image.width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);
          const tile={tx,ty,pixels,frozen:false};if(!tileTransparent(tile))store.tiles.set(tileKey(tx,ty),tile);}}
      else if(data.url)store=tileStoreFromList(await decodeTileBlob(data.url));
      else store=storeOf(data);
      let bounds=data.bounds??store.bounds;
      // Blob and legacy payloads hold full-resolution tiles; rasterize them
      // from the smallest mip still spanning ~64 px instead of reading bounds
      // at source resolution.
      if(bounds){const k=thumbnailLevel(bounds);if(k)store=levelStore({store,levels:[]},k);bounds=store.bounds;}
      if(!bounds||!validRect(bounds)){self.postMessage({id,width:1,height:1,pixels:new Uint8ClampedArray(4).buffer});return;}
      const source=new OffscreenCanvas(bounds.width,bounds.height);source.getContext('2d').putImageData(new ImageData(store.readRect(bounds.x,bounds.y,bounds.width,bounds.height),bounds.width,bounds.height),0,0);
      const ratio=Math.min(64/bounds.width,32/bounds.height),w=Math.max(1,Math.round(bounds.width*ratio)),h=Math.max(1,Math.round(bounds.height*ratio)),out=new OffscreenCanvas(w,h),ctx=out.getContext('2d');ctx.drawImage(source,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data;self.postMessage({id,width:w,height:h,pixels:rgba.buffer},[rgba.buffer]);return;
    }
    throw new Error('Unknown drawing worker operation.');
  } catch(error){self.postMessage({id,error:error.message});}
}
