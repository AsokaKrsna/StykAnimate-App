import {TILE,TileStore} from './drawing-tiles.mjs';

const newCanvas=(w,h)=>typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
let tileCanvas;
const tilesCanvas=()=>tileCanvas??=newCanvas(TILE,TILE);
/** Visible pixel-space rect under the current 2d transform (canvas bounds →
 * local space). */
export function visiblePixelRect(ctx){
  const w=ctx.canvas.width,h=ctx.canvas.height,inv=ctx.getTransform().inverse();
  const q=(x,y)=>({x:inv.a*x+inv.c*y+inv.e,y:inv.b*x+inv.d*y+inv.f});
  const cs=[q(0,0),q(w,0),q(w,h),q(0,h)];
  const x0=Math.min(...cs.map(p=>p.x)),y0=Math.min(...cs.map(p=>p.y));
  return{x:x0,y:y0,width:Math.max(...cs.map(p=>p.x))-x0,height:Math.max(...cs.map(p=>p.y))-y0};
}
/** Rasterize the tiles intersecting `rect` into one reusable scratch canvas per
 * presenter. Regions beyond maxSide are stored downscaled by an integer factor
 * (stopgap until mip levels); the returned rect stays in pixel space. `dirty`
 * is the canvas-space rect changed since the previous stamp, or null for all. */
export function presenterScratch(presenter,rect,{maxSide=4096}={}){
  const store=presenter.store,bounds=store?.bounds;if(!bounds)return null;
  const x=Math.max(rect.x,bounds.x),y=Math.max(rect.y,bounds.y),x1=Math.min(rect.x+rect.width,bounds.x+bounds.width),y1=Math.min(rect.y+rect.height,bounds.y+bounds.height);
  if(!(x1>x&&y1>y))return null;
  const scale=Math.ceil(Math.max((x1-x)/maxSide,(y1-y)/maxSide,1)),w=Math.ceil((x1-x)/scale),h=Math.ceil((y1-y)/scale);
  const s=presenter._scratch??={};
  const result={canvas:s.canvas,x,y,width:x1-x,height:y1-y,stamp:presenter.stamp,scale,dirty:null};
  if(s.canvas&&s.x===x&&s.y===y&&s.width===w&&s.height===h&&s.stamp===presenter.stamp)return result;
  const canvas=s.canvas??=newCanvas(w,h);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
  const c=canvas.getContext('2d');c.clearRect(0,0,w,h);
  if(scale===1){
    for(const [tx,ty] of TileStore.tilesInRect(x,y,x1-x,y1-y)){const tile=store.get(tx,ty);if(!tile)continue;c.putImageData(new ImageData(tile.pixels,TILE,TILE),tx*TILE-x,ty*TILE-y);}
  } else {
    const t=tilesCanvas(),tc=t.getContext('2d');
    for(const [tx,ty] of TileStore.tilesInRect(x,y,x1-x,y1-y)){const tile=store.get(tx,ty);if(!tile)continue;tc.clearRect(0,0,TILE,TILE);tc.putImageData(new ImageData(tile.pixels,TILE,TILE),0,0);c.drawImage(t,(tx*TILE-x)/scale,(ty*TILE-y)/scale,TILE/scale,TILE/scale);}
  }
  if(s.stamp>=0&&presenter.dirty){const d=presenter.dirty,dx=Math.max(d.x,x),dy=Math.max(d.y,y);
    result.dirty={x:Math.floor((dx-x)/scale),y:Math.floor((dy-y)/scale),width:Math.ceil((Math.min(d.x+d.width,x1)-dx)/scale),height:Math.ceil((Math.min(d.y+d.height,y1)-dy)/scale)};
    if(result.dirty.width<=0||result.dirty.height<=0)result.dirty=null;
  }
  Object.assign(s,{x,y,width:w,height:h,stamp:presenter.stamp});result.canvas=canvas;
  return result;
}
/** Paint the visible tiles under the context's current transform. */
export function paintDrawingTiles(ctx,presenter,{tint,tintFn}={}){
  const scratch=presenterScratch(presenter,visiblePixelRect(ctx));if(!scratch)return;
  let source=scratch.canvas;
  if(tint&&tintFn)source=tintFn(source,tint,scratch.stamp)??source;
  ctx.drawImage(source,scratch.x,scratch.y,scratch.width,scratch.height);
}
