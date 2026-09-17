import {TILE,TILE_BYTES,TileStore,tileKey,tileTransparent} from './drawing-tiles.mjs';
import {encodeDrawingPNG} from './drawing-png.mjs';

const newCanvas=(w,h)=>typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
/** Visible pixel-space rect under the current 2d transform (canvas bounds →
 * local space). */
export function visiblePixelRect(ctx){
  const w=ctx.canvas.width,h=ctx.canvas.height,inv=ctx.getTransform().inverse();
  const q=(x,y)=>({x:inv.a*x+inv.c*y+inv.e,y:inv.b*x+inv.d*y+inv.f});
  const cs=[q(0,0),q(w,0),q(w,h),q(0,h)];
  const x0=Math.min(...cs.map(p=>p.x)),y0=Math.min(...cs.map(p=>p.y));
  return{x:x0,y:y0,width:Math.max(...cs.map(p=>p.x))-x0,height:Math.max(...cs.map(p=>p.y))-y0};
}
const aligned=(x,y,width,height)=>{const x0=Math.floor(x/TILE)*TILE,y0=Math.floor(y/TILE)*TILE;return{x:x0,y:y0,width:Math.ceil((x+width)/TILE)*TILE-x0,height:Math.ceil((y+height)/TILE)*TILE-y0};};
const paintTile=(c,store,tx,ty,x,y)=>{const tile=store.get(tx,ty);if(tile)c.putImageData(new ImageData(tile.pixels,TILE,TILE),tx*TILE-x,ty*TILE-y);else c.clearRect(tx*TILE-x,ty*TILE-y,TILE,TILE);};

/** Level-k tile: the 2×2 box average of level k-1 tiles, computed with
 * premultiplied RGB and unpremultiplied once so translucent edges keep hue. */
function downTile(below,tx,ty){
  const subs=[below.get(2*tx,2*ty),below.get(2*tx+1,2*ty),below.get(2*tx,2*ty+1),below.get(2*tx+1,2*ty+1)];
  if(!subs.some(Boolean))return null;
  const pixels=subs.map(t=>t?.pixels),out=new Uint8ClampedArray(TILE_BYTES);
  for(let py=0;py<TILE;py++)for(let px=0;px<TILE;px++){
    const sub=pixels[(py>>5)*2+(px>>5)];if(!sub)continue;
    let pr=0,pg=0,pb=0,pa=0;
    for(let v=0;v<2;v++)for(let u=0;u<2;u++){const i=((2*(py&31)+v)*TILE+2*(px&31)+u)*4,a=sub[i+3];pa+=a;pr+=sub[i]*a;pg+=sub[i+1]*a;pb+=sub[i+2]*a;}
    const o=(py*TILE+px)*4;if(!pa)continue;
    out[o]=Math.round(pr/pa);out[o+1]=Math.round(pg/pa);out[o+2]=Math.round(pb/pa);out[o+3]=Math.round(pa/4);
  }
  return {tx,ty,pixels:out,frozen:false};
}
/** Derived mip chain on an entry: levels[k-1] is a TileStore of level-k tiles.
 * Missing tiles rebuild lazily from the level below; invalidateLevels drops
 * the covering tile at each level when source pixels change. */
export function levelStore(entry,k){
  if(k<=0)return entry.store;
  const below=levelStore(entry,k-1);if(!below)return null;
  const levels=entry.levels??=[];let level=levels[k-1];
  if(!level)level=levels[k-1]=new TileStore();
  let added=false;
  for(const t of below){const tx=Math.floor(t.tx/2),ty=Math.floor(t.ty/2);if(level.has(tx,ty))continue;
    const tile=downTile(below,tx,ty);if(tile&&!tileTransparent(tile)){level.tiles.set(tileKey(tx,ty),tile);added=true;}}
  if(added)level._changed();
  entry.owner?.levelsReserved?.(entry);return level;
}
/** Drop derived tiles covering `dirty` (source pixel space) at every level.
 * A null rect clears the whole chain. */
export function invalidateLevels(entry,dirty){
  const levels=entry.levels;if(!levels?.length)return;
  if(!dirty){entry.levels=null;return;}
  for(let k=1;k<=levels.length;k++){
    const level=levels[k-1];if(!level)continue;const f=TILE<<k;
    const x0=Math.floor(dirty.x/f),y0=Math.floor(dirty.y/f),x1=Math.floor((dirty.x+dirty.width-1)/f),y1=Math.floor((dirty.y+dirty.height-1)/f);
    for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++)level.delete(tx,ty);
  }
}
/** Rasterize the level-`level` tiles covering `rect` into one reusable,
 * tile-anchored scratch canvas per presenter. The scratch origin snaps to
 * tile boundaries with one tile of margin and clamps to the store's tile
 * coverage, so sub-tile pans reuse it unchanged; a stamp change re-blits only
 * the tiles intersecting `presenter.dirty`. Returns level-space geometry plus
 * `scale` (2**level) and `dirty` in canvas coordinates, or null when the
 * anchored rect exceeds maxSide (raise the level and retry). */
export function presenterScratch(presenter,rect,{maxSide=4096,level=0}={}){
  const scale=1<<level,store=level?presenter.level?.(level):presenter.store,coverage=store?.tileBounds;
  if(!coverage||!rect||!(rect.width>0&&rect.height>0))return null;
  const region=aligned(rect.x/scale-TILE,rect.y/scale-TILE,rect.width/scale+2*TILE,rect.height/scale+2*TILE);
  const x=Math.max(region.x,coverage.x),y=Math.max(region.y,coverage.y),x1=Math.min(region.x+region.width,coverage.x+coverage.width),y1=Math.min(region.y+region.height,coverage.y+coverage.height);
  if(!(x1>x&&y1>y)||x1-x>maxSide||y1-y>maxSide)return null;
  const w=x1-x,h=y1-y,anchorKey=`${level}:${x},${y},${w},${h}`,s=presenter._scratch??={blits:0};
  const result={canvas:s.canvas,x,y,width:w,height:h,level,scale,stamp:presenter.stamp,anchorKey,dirty:null};
  if(s.canvas&&s.anchorKey===anchorKey){
    if(s.stamp===presenter.stamp)return result;
    const c=s.canvas.getContext('2d'),d=presenter.dirty;presenter.dirty=null;
    const dr=d?{x:Math.floor(d.x/scale),y:Math.floor(d.y/scale),width:Math.ceil((d.x+d.width)/scale)-Math.floor(d.x/scale),height:Math.ceil((d.y+d.height)/scale)-Math.floor(d.y/scale)}:{x,y,width:w,height:h};
    // Tiles outside the anchored rect are clipped away before blitting.
    const bx=Math.max(dr.x,x),by=Math.max(dr.y,y),bx1=Math.min(dr.x+dr.width,x+w),by1=Math.min(dr.y+dr.height,y+h);
    for(const [tx,ty] of TileStore.tilesInRect(bx,by,Math.max(0,bx1-bx),Math.max(0,by1-by))){paintTile(c,store,tx,ty,x,y);s.blits++;}
    s.stamp=presenter.stamp;result.canvas=s.canvas;
    const dx=Math.max(dr.x,x),dy=Math.max(dr.y,y),dw=Math.min(dr.x+dr.width,x+w)-dx,dh=Math.min(dr.y+dr.height,y+h)-dy;
    if(dw>0&&dh>0)result.dirty={x:dx-x,y:dy-y,width:dw,height:dh};
    return result;
  }
  const canvas=s.canvas??=newCanvas(1,1);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
  presenter.owner?.scratchReserved?.(presenter);
  const c=canvas.getContext('2d');c.clearRect(0,0,w,h);
  for(const [tx,ty] of TileStore.tilesInRect(x,y,w,h)){paintTile(c,store,tx,ty,x,y);s.blits++;}
  Object.assign(s,{anchorKey,stamp:presenter.stamp});presenter.dirty=null;result.canvas=canvas;
  return result;
}
/** Paint the visible tiles under the context's current transform. The mip
 * level follows the output sampling density; the scratch is one image, so no
 * seams can appear between tiles, and its one-tile margin keeps filter taps
 * inside painted coverage at every zoom and rotation. */
export function paintDrawingTiles(ctx,presenter,{tint,tintFn}={}){
  const m=ctx.getTransform(),rect=visiblePixelRect(ctx);
  const k0=Math.max(0,Math.min(4,Math.floor(-Math.log2(Math.hypot(m.a,m.b)||1))));
  for(let k=k0;k<=4;k++){
    const scratch=presenterScratch(presenter,rect,{level:k});if(!scratch)continue;
    let source=scratch.canvas;
    if(tint&&tintFn)source=tintFn(source,tint,`${scratch.stamp}:${scratch.anchorKey}`)??source;
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(source,scratch.x*scratch.scale,scratch.y*scratch.scale,scratch.width*scratch.scale,scratch.height*scratch.scale);
    return;
  }
}
/** Flatten a tile store (or a {store,level} presenter) into a PNG data URL of
 * its bounds. Regions beyond maxPixels rasterize at the largest mip level
 * that fits; `scale` records the source pixels per PNG pixel and `x`,`y` the
 * source-space origin so callers can re-anchor placement. */
export async function flattenedDrawingPNG(holder,{maxPixels=16*1024*1024}={}){
  const entry=holder.store?holder:{store:holder,levels:[]},base=entry.store,bounds=base?.bounds;if(!bounds)return null;
  let k=0,level=base;
  while(bounds.width*bounds.height/(1<<(2*k))>maxPixels&&k<4){k++;level=holder.level?holder.level(k):levelStore(entry,k);if(!level)return null;}
  const f=1<<k,x=Math.floor(bounds.x/f),y=Math.floor(bounds.y/f),w=Math.max(1,Math.ceil((bounds.x+bounds.width)/f)-x),h=Math.max(1,Math.ceil((bounds.y+bounds.height)/f)-y);
  const pixels=level.readRect(x,y,w,h);
  return {dataUrl:await encodeDrawingPNG(pixels,w,h),width:w,height:h,scale:f,x:x*f,y:y*f,level:k};
}
