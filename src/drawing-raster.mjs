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
  const out=new Uint8ClampedArray(TILE_BYTES),H=TILE>>1;
  // One quadrant per source tile; each output pixel averages a 2x2 block.
  for(let q=0;q<4;q++){
    const sub=subs[q]?.pixels;if(!sub)continue;
    const ox=(q&1)*H,oy=(q>>1)*H;
    for(let py=0;py<H;py++){
      let i=(2*py*TILE)*4,o=((oy+py)*TILE+ox)*4;
      for(let px=0;px<H;px++,i+=8,o+=4){
        const j=i+TILE*4,a0=sub[i+3],a1=sub[i+7],a2=sub[j+3],a3=sub[j+7],pa=a0+a1+a2+a3;
        if(!pa)continue;
        out[o]=Math.round((sub[i]*a0+sub[i+4]*a1+sub[j]*a2+sub[j+4]*a3)/pa);
        out[o+1]=Math.round((sub[i+1]*a0+sub[i+5]*a1+sub[j+1]*a2+sub[j+5]*a3)/pa);
        out[o+2]=Math.round((sub[i+2]*a0+sub[i+6]*a1+sub[j+2]*a2+sub[j+6]*a3)/pa);
        out[o+3]=Math.round(pa/4);
      }
    }
  }
  return {tx,ty,pixels:out,frozen:false};
}
/** Derived mip chain on an entry: levels[k-1] is a TileStore of level-k tiles.
 * invalidateLevels queues the covering tile at each level when source pixels
 * change, and only queued tiles rebuild, so a stroke costs work proportional
 * to what it touched rather than to the drawing's size. Tiles appearing in
 * or leaving the level below without an invalidation (a changed tile count)
 * are reconciled by a coverage scan. */
export function levelStore(entry,k){
  if(k<=0)return entry.store;
  const below=levelStore(entry,k-1);if(!below)return null;
  const levels=entry.levels??=[];let level=levels[k-1];
  if(!level)level=levels[k-1]=new TileStore();
  let changed=false;
  const rebuild=(tx,ty)=>{const tile=downTile(below,tx,ty);if(tile&&!tileTransparent(tile))level.tiles.set(tileKey(tx,ty),tile);else if(!level.tiles.delete(tileKey(tx,ty)))return;changed=true;};
  if(level.pending){for(const key of level.pending){const [tx,ty]=key.split(',').map(Number);rebuild(tx,ty);}level.pending=null;}
  if(level.scanned!==below.size){
    for(const t of below){const tx=Math.floor(t.tx/2),ty=Math.floor(t.ty/2);if(!level.has(tx,ty))rebuild(tx,ty);}
    for(const t of [...level.values()])if(!below.has(2*t.tx,2*t.ty)&&!below.has(2*t.tx+1,2*t.ty)&&!below.has(2*t.tx,2*t.ty+1)&&!below.has(2*t.tx+1,2*t.ty+1)){level.tiles.delete(tileKey(t.tx,t.ty));changed=true;}
    level.scanned=below.size;
  }
  if(changed)level._changed();
  entry.owner?.levelsReserved?.(entry);return level;
}
/** Queue the derived tiles covering `dirty` (source pixel space) at every
 * level for rebuild on next use. A null rect clears the whole chain. */
export function invalidateLevels(entry,dirty){
  const levels=entry.levels;if(!levels?.length)return;
  if(!dirty){entry.levels=null;return;}
  for(let k=1;k<=levels.length;k++){
    const level=levels[k-1];if(!level)continue;const f=TILE<<k;
    const x0=Math.floor(dirty.x/f),y0=Math.floor(dirty.y/f),x1=Math.floor((dirty.x+dirty.width-1)/f),y1=Math.floor((dirty.y+dirty.height-1)/f);
    // A huge dirty rect is cheaper to rebuild from scratch than to enumerate.
    if((x1-x0+1)*(y1-y0+1)>4096){levels[k-1]=null;continue;}
    const pending=level.pending??=new Set();
    for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++)pending.add(tileKey(tx,ty));
  }
}
/** Rasterize the level-`level` tiles covering `rect` into a tile-anchored
 * scratch canvas. Each presenter keeps a small LRU of scratches keyed by
 * anchor so the WebGPU and Canvas/onion paths — and alternating view rects —
 * never share one canvas. Hysteresis: a request fully inside a scratch's
 * painted `cover` reuses it without computing a new anchor, so zooming into
 * an already-painted region costs no repaint. A stamp change re-blits only
 * the tiles intersecting that scratch's `pending` rect (level-space; null
 * means the whole cover). Returns level-space geometry plus `scale`
 * (2**level) and `dirty` in canvas coordinates, or null when the anchored
 * rect exceeds maxSide (raise the level and retry). With `clamp`, an
 * oversized region is trimmed to maxSide around the wanted span instead —
 * a guaranteed scratch whenever the wanted rect overlaps coverage; distant
 * coverage outside the window simply waits for a nearer view. */
export function presenterScratch(presenter,rect,{maxSide=4096,level=0,clamp=false}={}){
  const scale=1<<level,store=level?presenter.level?.(level):presenter.store,coverage=store?.tileBounds;
  if(!coverage||!rect||!(rect.width>0&&rect.height>0))return null;
  const scratches=presenter._scratches??=new Map();
  const want={x:rect.x/scale,y:rect.y/scale,right:(rect.x+rect.width)/scale,bottom:(rect.y+rect.height)/scale};
  let s=null;
  for(const candidate of scratches.values()){
    const c=candidate.cover;
    if(candidate.level!==level||!c)continue;
    if(want.x>=c.x&&want.y>=c.y&&want.right<=c.x+c.width&&want.bottom<=c.y+c.height&&(!s||c.width*c.height<s.cover.width*s.cover.height))s=candidate;
  }
  if(!s){
    const region=aligned(rect.x/scale-TILE,rect.y/scale-TILE,rect.width/scale+2*TILE,rect.height/scale+2*TILE);
    let x=Math.max(region.x,coverage.x),y=Math.max(region.y,coverage.y),x1=Math.min(region.x+region.width,coverage.x+coverage.width),y1=Math.min(region.y+region.height,coverage.y+coverage.height);
    if(!(x1>x&&y1>y))return null;
    if(x1-x>maxSide||y1-y>maxSide){
      if(!clamp)return null;
      // Too large even for this mip: keep the maxSide window covering as
      // much of the wanted span as possible, centered on it.
      if(x1-x>maxSide){const mid=(Math.max(x,want.x)+Math.min(x1,want.right))/2;x=Math.max(x,Math.min(Math.floor(mid-maxSide/2),x1-maxSide));x1=x+maxSide;}
      if(y1-y>maxSide){const mid=(Math.max(y,want.y)+Math.min(y1,want.bottom))/2;y=Math.max(y,Math.min(Math.floor(mid-maxSide/2),y1-maxSide));y1=y+maxSide;}
    }
    const anchorKey=`${level}:${x},${y},${x1-x},${y1-y}`;
    s=scratches.get(anchorKey);
    if(!s){
      s={anchorKey,level,cover:{x,y,width:x1-x,height:y1-y},canvas:null,ctx:null,stamp:-1,pending:null,blits:0,used:0};
      scratches.set(anchorKey,s);
      if(scratches.size>4){ // bounded LRU: drop the least-recently-used anchor
        let oldest=null,oldestKey=null;
        for(const [key,c] of scratches)if(c!==s&&(!oldest||c.used<oldest.used)){oldest=c;oldestKey=key;}
        if(oldest){if(oldest.canvas)oldest.canvas.width=oldest.canvas.height=1;scratches.delete(oldestKey);}
      }
      presenter.owner?.scratchReserved?.(presenter);
    }
  }
  s.used=presenter._scratchClock=(presenter._scratchClock??0)+1;
  const {x,y,width:w,height:h}=s.cover;
  const result={canvas:s.canvas,x,y,width:w,height:h,level,scale,stamp:presenter.stamp,anchorKey:s.anchorKey,dirty:null};
  if(s.canvas&&s.stamp===presenter.stamp)return result;
  s.canvas??=newCanvas(w,h);s.ctx??=s.canvas.getContext('2d');
  if(s.canvas.width!==w)s.canvas.width=w;if(s.canvas.height!==h)s.canvas.height=h;
  const c=s.ctx,pending=s.pending??s.cover;
  const bx=Math.max(pending.x,x),by=Math.max(pending.y,y),bx1=Math.min(pending.x+pending.width,x+w),by1=Math.min(pending.y+pending.height,y+h);
  const full=pending===s.cover||(bx<=x&&by<=y&&bx1>=x+w&&by1>=y+h);
  if(full)c.clearRect(0,0,w,h);
  for(const [tx,ty] of TileStore.tilesInRect(bx,by,Math.max(0,bx1-bx),Math.max(0,by1-by))){paintTile(c,store,tx,ty,x,y);s.blits++;}
  s.stamp=presenter.stamp;s.pending=null;result.canvas=s.canvas;
  if(!full){
    // Tiles repaint wholesale, so the upload region is the tile-aligned
    // coverage of the repainted band clipped to the canvas.
    const tx0=Math.floor(bx/TILE)*TILE,ty0=Math.floor(by/TILE)*TILE,tx1=Math.ceil(bx1/TILE)*TILE,ty1=Math.ceil(by1/TILE)*TILE;
    const dx0=Math.max(tx0,x),dy0=Math.max(ty0,y),dx1=Math.min(tx1,x+w),dy1=Math.min(ty1,y+h);
    result.dirty=dx1>dx0&&dy1>dy0?{x:dx0-x,y:dy0-y,width:dx1-dx0,height:dy1-dy0}:{x:0,y:0,width:0,height:0};
  }
  return result;
}
/** Paint tiles through bounded strip canvases when even the smallest mip's
 * anchored region exceeds the scratch ceiling. Each strip paints a one-tile
 * margin but only draws its core, so smoothing taps read real neighbours and
 * the cores tile the region exactly — same pixels, bounded memory. */
function paintDrawingStrips(ctx,presenter,rect,level,{tint,tintFn}={}){
  const scale=1<<level,store=level?presenter.level?.(level):presenter.store,coverage=store?.tileBounds;
  if(!coverage)return;
  const region=aligned(rect.x/scale-TILE,rect.y/scale-TILE,rect.width/scale+2*TILE,rect.height/scale+2*TILE);
  const x=Math.max(region.x,coverage.x),y=Math.max(region.y,coverage.y),
    x1=Math.min(region.x+region.width,coverage.x+coverage.width),y1=Math.min(region.y+region.height,coverage.y+coverage.height);
  if(!(x1>x&&y1>y))return;
  const STRIP=4096;
  for(let cy=y;cy<y1;cy+=STRIP){
    const cy1=Math.min(y1,cy+STRIP);
    for(let cx=x;cx<x1;cx+=STRIP){
      const cx1=Math.min(x1,cx+STRIP),
        px0=Math.max(region.x,cx-TILE),py0=Math.max(region.y,cy-TILE),
        px1=Math.min(region.x+region.width,cx1+TILE),py1=Math.min(region.y+region.height,cy1+TILE);
      const canvas=newCanvas(px1-px0,py1-py0),c=canvas.getContext('2d');
      for(const [tx,ty] of TileStore.tilesInRect(px0,py0,px1-px0,py1-py0))paintTile(c,store,tx,ty,px0,py0);
      let source=canvas;
      if(tint&&tintFn)source=tintFn(canvas,tint,`${presenter.stamp}:${level}:${cx},${cy}`)??canvas;
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      // The source sub-rect drops the margin; core rects tile seamlessly.
      ctx.drawImage(source,cx-px0,cy-py0,cx1-cx,cy1-cy,cx*scale,cy*scale,(cx1-cx)*scale,(cy1-cy)*scale);
    }
  }
}
/** Paint the visible tiles under the context's current transform. The mip
 * level follows the output sampling density; the scratch is one image, so no
 * seams can appear between tiles, and its one-tile margin keeps filter taps
 * inside painted coverage at every zoom and rotation. Regions larger than the
 * scratch ceiling at every mip still paint exactly, streamed through strips. */
export function paintDrawingTiles(ctx,presenter,{tint,tintFn}={}){
  const m=ctx.getTransform(),rect=visiblePixelRect(ctx);
  const k0=Math.max(0,Math.min(8,Math.floor(-Math.log2(Math.hypot(m.a,m.b)||1))));
  for(let k=k0;k<=8;k++){
    const scratch=presenterScratch(presenter,rect,{level:k});if(!scratch)continue;
    let source=scratch.canvas;
    if(tint&&tintFn)source=tintFn(source,tint,`${scratch.stamp}:${scratch.anchorKey}`)??source;
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(source,scratch.x*scratch.scale,scratch.y*scratch.scale,scratch.width*scratch.scale,scratch.height*scratch.scale);
    return;
  }
  paintDrawingStrips(ctx,presenter,rect,presenter.level?8:0,{tint,tintFn});
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
