import {TILE,TILE_BYTES,TileStore,tileKey} from './drawing-tiles.mjs';
import {tileChanges} from './drawing-pixels.mjs';
import {transformTiles,transformBounds,transformSupportBounds,tileIntersects,TRANSFORM_BYTES} from './drawing-transform.mjs';
import {paintDrawingTiles} from './drawing-raster.mjs';

export function selectionMatrix(s){const a=s.angle*Math.PI/180,c=Math.cos(a)*s.scale,n=Math.sin(a)*s.scale;return[c,n,-n,c,s.cx+s.dx-c*s.cx+n*s.cy,s.cy+s.dy-n*s.cx-c*s.cy];}
export const selectionBounds=transformBounds;
export function selectionTiles(store,mask,m,filter){const destination=transformSupportBounds(mask,m,filter);return [...store].filter(t=>tileIntersects(t,mask)||tileIntersects(t,destination));}
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});

/** Commit in the pixel worker. Preview canvases never become source pixels.
 * Unselected bytes are preserved exactly, including RGB at low/zero alpha. */
export function transformSelectedPixels(store,{mask,pixels,matrix,remove=false,filter='smooth',maxBytes=TRANSFORM_BYTES}){
  const before=new Map(),B=mask,source=new TileStore();
  if(!B||!Number.isInteger(B.width)||!Number.isInteger(B.height)||B.width<1||B.height<1||B.width*B.height>16*1024*1024||pixels.length!==B.width*B.height*4||B.mask.length!==B.width*B.height||matrix.length!==6||!matrix.every(Number.isFinite))throw new Error('Invalid pixel selection.');
  const inputBytes=pixels.byteLength+B.mask.byteLength;
  const edit=(tx,ty)=>{const key=tileKey(tx,ty);if(!before.has(key)){
    if(inputBytes+store.bytes+source.bytes+(before.size+1)*TILE_BYTES*2>maxBytes)throw new Error('The selection exceeds the drawing working memory limit.');
    before.set(key,store.get(tx,ty)?.pixels.slice()??null);return store.writable(tx,ty).pixels;
  }return store.get(tx,ty).pixels;};
  for(let y=0;y<B.height;y++)for(let x=0;x<B.width;x++)if(B.mask[y*B.width+x]){
    const px=B.x+x,py=B.y+y,tx=Math.floor(px/TILE),ty=Math.floor(py/TILE),tile=store.get(tx,ty),i=((py-ty*TILE)*TILE+px-tx*TILE)*4;
    if(tile?.pixels[i+3])edit(tx,ty)[i+3]=0;
    const p=(y*B.width+x)*4;
    if(!remove&&pixels[p+3]){
      let dest=source.get(tx,ty);if(!dest){if(inputBytes+store.bytes+source.bytes+(before.size+1)*TILE_BYTES*2>maxBytes)throw new Error('The selection exceeds the drawing working memory limit.');dest=source.writable(tx,ty);}
      dest.pixels.set(pixels.subarray(p,p+4),i);
    }
  }
  if(!remove)transformTiles(source,matrix,{target:store,before,filter,maxBytes:maxBytes-inputBytes});
  return tileChanges(store,before);
}

/** Selection is a compositor view, not a mutation of the cel. Each preview
 * allocates at most one viewport-sized scratch regardless of move distance. */
export function selectionPresenter(selection,base){
  const s=selection,p={id:base.id+'-selection',stamp:0,store:{get bounds(){const a=base.store.bounds,b=selectionBounds(s.mask,selectionMatrix(s));if(!a)return b;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}}};
  p.dispose=()=>{if(p.canvas)p.canvas.width=p.canvas.height=1;};
  p.scratch=(rect,{level=0,maxSide=4096,clamp=false}={})=>{
    const f=2**level,x=Math.floor(rect.x/f/TILE)*TILE,y=Math.floor(rect.y/f/TILE)*TILE,w=Math.ceil((rect.x+rect.width)/f/TILE)*TILE-x,h=Math.ceil((rect.y+rect.height)/f/TILE)*TILE-y;
    const side=Math.min(maxSide,4096);if((w>side||h>side)&&!clamp)return null;
    const width=Math.max(1,Math.min(side,w)),height=Math.max(1,Math.min(side,h)),key=`selection:${level}:${x},${y},${width},${height}`;
    if(p.key!==key||p.drawn!==p.stamp||p.baseStamp!==base.stamp){
      p.canvas??=canvas(width,height);if(p.canvas.width!==width)p.canvas.width=width;if(p.canvas.height!==height)p.canvas.height=height;
      const ctx=p.canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,width,height);ctx.setTransform(1/f,0,0,1/f,-x,-y);paintDrawingTiles(ctx,base);
      ctx.globalCompositeOperation='destination-out';ctx.drawImage(s.maskCanvas,s.mask.x,s.mask.y);ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=s.filter!=='nearest';ctx.transform(...selectionMatrix(s));ctx.drawImage(s.cutout,s.mask.x,s.mask.y);
      p.key=key;p.drawn=p.stamp;p.baseStamp=base.stamp;
    }
    return{canvas:p.canvas,x,y,width,height,scale:f,level,stamp:p.stamp,anchorKey:key,dirty:null};
  };
  return p;
}
