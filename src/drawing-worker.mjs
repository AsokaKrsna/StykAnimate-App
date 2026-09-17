import {TILE,TILE_BYTES,tileKey,TileStore,tileTransparent} from './drawing-tiles.mjs';
import {floodTiles,tileChanges,tileAlignedRect} from './drawing-pixels.mjs';
import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {encodeDrawingPNG,decodeDrawingPNG,decodeDrawingPNGBytes} from './drawing-png.mjs';
import {decodeTileBlob,tileStoreFromList} from './drawing-tile-codec.mjs';
import {encodePNGPortable} from './sticknodes/decoder/png-browser.mjs';

const storeOf=data=>{const store=new TileStore();for(const t of data.tiles??[])store.tiles.set(tileKey(t.tx,t.ty),{tx:t.tx,ty:t.ty,pixels:new Uint8ClampedArray(t.pixels),frozen:false,png:t.png?new Uint8Array(t.png):undefined});return store;};
const beforeOf=(store,rect)=>{const before=new Map();for(const [tx,ty] of TileStore.tilesInRect(rect.x,rect.y,rect.width,rect.height))before.set(tileKey(tx,ty),store.get(tx,ty)?.pixels.slice()??null);return before;};
const changesReply=(id,store,before,maxBytes)=>{const tiles=tileChanges(store,before,maxBytes);self.postMessage({id,tiles},tiles.flatMap(t=>[t.before?.buffer,t.after?.buffer].filter(Boolean)));};
const validRect=r=>r&&[r.x,r.y].every(Number.isSafeInteger)&&Number.isInteger(r.width)&&Number.isInteger(r.height)&&r.width>0&&r.height>0&&r.width*r.height<=DRAWING_MAX_PIXELS;

async function tilePixels(tile){
  if(tile.pixels)return new Uint8ClampedArray(tile.pixels);
  const decoded=await decodeDrawingPNGBytes(new Uint8Array(tile.png));
  if(decoded.width!==TILE||decoded.height!==TILE)throw new Error('Drawing tile blob carries a non-tile image.');
  return decoded.pixels;
}

self.onmessage=async({data})=>{
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
      const out=[];
      for(const t of data.tiles??[])if(!t.png)out.push({tx:t.tx,ty:t.ty,png:(await encodePNGPortable({width:TILE,height:TILE,channels:4},new Uint8ClampedArray(t.pixels))).buffer});
      let dataUrl,width,height;
      if(data.region){
        if(!validRect(data.region))throw new Error('Invalid drawing encode region.');
        const r=data.region,pixels=new Uint8ClampedArray(r.width*r.height*4);
        for(const t of data.tiles??[]){
          const source=await tilePixels(t),ox=t.tx*TILE-r.x,oy=t.ty*TILE-r.y;
          for(let py=Math.max(0,-oy);py<Math.min(TILE,r.height-oy);py++)
            pixels.set(source.subarray((py*TILE+Math.max(0,-ox))*4,(py*TILE+Math.min(TILE,r.width-ox))*4),((py+oy)*r.width+Math.max(0,ox))*4);
        }
        dataUrl=await encodeDrawingPNG(pixels,r.width,r.height);width=r.width;height=r.height;
      }
      self.postMessage({id,tiles:out,dataUrl,width,height},out.map(t=>t.png));return;
    }
    if(kind==='fill'){
      if(!validRect(data.bounds))throw new Error('Invalid fill bounds.');
      const store=storeOf(data),before=beforeOf(store,data.bounds);
      floodTiles(store,{...data.options,bounds:data.bounds,source:data.source?new Uint8ClampedArray(data.source):undefined});
      changesReply(id,store,before,data.maxBytes);return;
    }
    if(kind==='paste'){
      if(!validRect(data.bounds))throw new Error('Invalid paste bounds.');
      const store=storeOf(data),before=beforeOf(store,data.bounds);
      const source=await decodeDrawingPNG(data.clip.dataUrl),{x,y,ratio}=data;
      if(source.width!==data.clip.width||source.height!==data.clip.height||![x,y,ratio].every(Number.isFinite)||ratio<=0)throw new Error('Invalid drawing paste.');
      if(ratio===1&&Number.isInteger(x)&&Number.isInteger(y)){
        for(let sy=0;sy<source.height;sy++)for(let sx=0;sx<source.width;sx++){
          const i=(sy*source.width+sx)*4,alpha=source.pixels[i+3]/255;if(!alpha)continue;
          const dx=x+sx,dy=y+sy,tile=store.writable(Math.floor(dx/TILE),Math.floor(dy/TILE)),j=((dy-tile.ty*TILE)*TILE+(dx-tile.tx*TILE))*4;
          if(!tile.pixels[j+3]||alpha===1){for(let c=0;c<4;c++)tile.pixels[j+c]=source.pixels[i+c];continue;}
          const base=tile.pixels[j+3]/255,out=alpha+base*(1-alpha);
          for(let c=0;c<3;c++)tile.pixels[j+c]=Math.round((source.pixels[i+c]*alpha+tile.pixels[j+c]*base*(1-alpha))/out);
          tile.pixels[j+3]=Math.round(out*255);
        }
      }else{
        const dw=Math.ceil(source.width*ratio),dh=Math.ceil(source.height*ratio);
        const rect=tileAlignedRect(Math.floor(x),Math.floor(y),Math.max(1,Math.ceil(x+dw)-Math.floor(x)),Math.max(1,Math.ceil(y+dh)-Math.floor(y)));
        const input=new OffscreenCanvas(source.width,source.height),output=new OffscreenCanvas(rect.width,rect.height),ctx=output.getContext('2d');
        input.getContext('2d').putImageData(new ImageData(source.pixels,source.width,source.height),0,0);
        ctx.putImageData(new ImageData(store.readRect(rect.x,rect.y,rect.width,rect.height),rect.width,rect.height),0,0);
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(input,x-rect.x,y-rect.y,dw,dh);
        const pixels=ctx.getImageData(0,0,rect.width,rect.height);
        for(const [tx,ty] of TileStore.tilesInRect(rect.x,rect.y,rect.width,rect.height)){const tile=store.writable(tx,ty),ox=tx*TILE-rect.x,oy=ty*TILE-rect.y;
          for(let py=Math.max(0,-oy);py<Math.min(TILE,rect.height-oy);py++)tile.pixels.set(pixels.data.subarray(((py+oy)*rect.width+Math.max(0,ox))*4,((py+oy)*rect.width+Math.min(rect.width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);}
      }
      changesReply(id,store,before,data.maxBytes);return;
    }
    if(kind==='resample'){
      const bounds=data.bounds,ratio=data.ratio;
      if(!validRect(bounds)||!Number.isFinite(ratio)||ratio<=0)throw new Error('Invalid drawing resample.');
      const store=storeOf(data),pixels=store.readRect(bounds.x,bounds.y,bounds.width,bounds.height);
      const source=new OffscreenCanvas(bounds.width,bounds.height);source.getContext('2d').putImageData(new ImageData(pixels,bounds.width,bounds.height),0,0);
      const x0=Math.floor(bounds.x*ratio),y0=Math.floor(bounds.y*ratio),w=Math.max(1,Math.ceil((bounds.x+bounds.width)*ratio)-x0),h=Math.max(1,Math.ceil((bounds.y+bounds.height)*ratio)-y0);
      if(w*h>DRAWING_MAX_PIXELS)throw new Error('The resampled drawing exceeds the pixel limit.');
      const output=new OffscreenCanvas(w,h),ctx=output.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,bounds.x*ratio-x0,bounds.y*ratio-y0,bounds.width*ratio,bounds.height*ratio);
      const resampled=ctx.getImageData(0,0,w,h).data,out=new TileStore();
      for(const [tx,ty] of TileStore.tilesInRect(x0,y0,w,h)){
        const tile={tx,ty,pixels:new Uint8ClampedArray(TILE_BYTES),frozen:false},ox=tx*TILE-x0,oy=ty*TILE-y0;
        for(let py=Math.max(0,-oy);py<Math.min(TILE,h-oy);py++)tile.pixels.set(resampled.subarray(((py+oy)*w+Math.max(0,ox))*4,((py+oy)*w+Math.min(w,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);
        if(!tileTransparent(tile))out.tiles.set(tileKey(tx,ty),tile);
      }
      const tiles=[...out].map(t=>({tx:t.tx,ty:t.ty,pixels:t.pixels.buffer}));
      self.postMessage({id,tiles,bounds:out.bounds},tiles.map(t=>t.pixels));return;
    }
    if(kind==='thumbnail'){
      let store;
      if(data.legacy){const image=await decodeDrawingPNG(data.legacy.url),crop=data.legacy.crop??{x:0,y:0};store=new TileStore();
        for(const [tx,ty] of TileStore.tilesInRect(crop.x,crop.y,image.width,image.height)){const pixels=new Uint8ClampedArray(TILE_BYTES),ox=tx*TILE-crop.x,oy=ty*TILE-crop.y;
          for(let py=Math.max(0,-oy);py<Math.min(TILE,image.height-oy);py++)pixels.set(image.pixels.subarray(((py+oy)*image.width+Math.max(0,ox))*4,((py+oy)*image.width+Math.min(image.width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);
          const tile={tx,ty,pixels,frozen:false};if(!tileTransparent(tile))store.tiles.set(tileKey(tx,ty),tile);}}
      else if(data.url)store=tileStoreFromList(await decodeTileBlob(data.url));
      else store=storeOf(data);
      const bounds=data.bounds??store.bounds;
      if(!bounds||!validRect(bounds)){self.postMessage({id,width:1,height:1,pixels:new Uint8ClampedArray(4).buffer});return;}
      const source=new OffscreenCanvas(bounds.width,bounds.height);source.getContext('2d').putImageData(new ImageData(store.readRect(bounds.x,bounds.y,bounds.width,bounds.height),bounds.width,bounds.height),0,0);
      const ratio=Math.min(64/bounds.width,32/bounds.height),w=Math.max(1,Math.round(bounds.width*ratio)),h=Math.max(1,Math.round(bounds.height*ratio)),out=new OffscreenCanvas(w,h),ctx=out.getContext('2d');ctx.drawImage(source,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data;self.postMessage({id,width:w,height:h,pixels:rgba.buffer},[rgba.buffer]);return;
    }
    throw new Error('Unknown drawing worker operation.');
  } catch(error){self.postMessage({id,error:error.message});}
};
