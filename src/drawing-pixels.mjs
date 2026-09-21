import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {TILE,TILE_BYTES,tileKey,TileStore} from './drawing-tiles.mjs';
import {DrawingSmoother} from './drawing-smoother.mjs';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function assertPixels(pixels,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>DRAWING_MAX_PIXELS||
    !(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw new Error('Invalid drawing pixel surface.');
}
export function compactTile(bytes){
  if(bytes==null)return null;
  for(let i=4;i<bytes.length;i++)if(bytes[i]!==bytes[i%4])return bytes;
  return bytes.slice(0,4);
}
// A uniform fully transparent tile is pruned on apply, so it equals absent.
const normSide=v=>v&&v.byteLength===4&&v[3]===0?null:v;
const expandSide=bytes=>{if(bytes==null||bytes.byteLength===TILE_BYTES)return bytes??null;const out=new Uint8ClampedArray(TILE_BYTES);for(let i=0;i<bytes.length;i+=4)out.set(bytes,i);return out;};
const sideEqual=(a,b)=>a===b||(a&&b&&a.length===b.length&&a.every((n,i)=>n===b[i]));
/** Tile-oriented undo records: {tx,ty,before,after} with each side null, a
 * 4-byte uniform array, or a full tile. `beforeTiles` maps tile keys to the
 * pre-edit pixels (or null when absent) and must cover every tile touched. */
/** The undo record is exact: every touched tile keeps its pre-edit pixels. An
 * edit is never refused for size — history eviction retires older records. */
export function tileChanges(store,beforeTiles) {
  const changes=[];
  for(const [key,beforeValue] of beforeTiles){
    const [tx,ty]=key.split(',').map(Number),afterValue=store.get(tx,ty)?.pixels??null;
    if(beforeValue===null&&afterValue===null)continue;
    if(beforeValue&&afterValue&&sideEqual(beforeValue,afterValue))continue;
    const before=normSide(compactTile(beforeValue)),after=normSide(compactTile(afterValue));
    if(before===null&&after===null)continue;
    changes.push({tx,ty,before,after});
  }
  return changes;
}
export function applyTileChanges(store,changes,direction) {
  for(const change of changes){const value=change[direction];if(value==null)store.delete(change.tx,change.ty);else store.set(change.tx,change.ty,value);}
}
export const pixelChangeBytes=tiles=>tiles.reduce((n,t)=>n+(t.before?.byteLength??0)+(t.after?.byteLength??0)+64,256);
/** Bounding rect of every tile intersected by a pixel-space rect. */
export function tileAlignedRect(x,y,width,height){
  const x0=Math.floor(x/TILE)*TILE,y0=Math.floor(y/TILE)*TILE;
  return{x:x0,y:y0,width:Math.ceil((x+width)/TILE)*TILE-x0,height:Math.ceil((y+height)/TILE)*TILE-y0};
}
/** Deterministic pixel grain: pure function of integer pixel coords + seed. */
const hashPixel=(x,y,seed)=>{let h=(Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,974711))>>>0;h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967296;};

/** Exact CPU raster with tile-local stroke coverage on an unbounded TileStore.
 * Opacity caps an entire stroke; flow accumulates dabs without multiplying it.
 * Stabilization is a distance-windowed trailing average over the raw path, so
 * every sample yields output with no dead zone; consecutive pushed points are
 * joined by quadratic midpoint segments, which keeps corners smooth at zero
 * lag, and the stroke still ends exactly on the final input. */
export class DrawingStroke {
  constructor(store,{size=8,color=[0,0,0],opacity=1,flow=1,hardness=1,erase=false,pressureSize=true,pressureOpacity=false,sizeCurve=1,opacityCurve=1,stabilization=0,spacingRatio=.12,texture=0,seed=0,pixelsPerUnit=1,maxBytes=48*1024*1024}={}) {
    if(!(store instanceof TileStore))throw new Error('Strokes draw into a tile store.');
    if(![size,opacity,flow,hardness,sizeCurve,opacityCurve,stabilization,spacingRatio,texture,pixelsPerUnit].every(Number.isFinite)||!Array.isArray(color)||color.length!==3||!color.every(Number.isFinite))throw new Error('Invalid brush settings.');
    Object.assign(this,{store,size:clamp(size,.5,8192),color:color.map(n=>clamp(n,0,255)),opacity:clamp(opacity),flow:clamp(flow),hardness:clamp(hardness),erase,pressureSize,pressureOpacity,sizeCurve:clamp(sizeCurve,.1,4),opacityCurve:clamp(opacityCurve,.1,4),stabilization:clamp(stabilization,0,.95),spacingRatio:clamp(spacingRatio,.01,1),texture:clamp(texture),seed:seed>>>0,pixelsPerUnit:clamp(pixelsPerUnit,.01,64),maxBytes,tiles:new Map(),bytes:256,dirty:null,dirtyTiles:new Set(),rand:seed>>>0});
  }
  nextRand(){let t=this.rand=(this.rand+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
  tile(tx,ty) {
    const key=tileKey(tx,ty);let tile=this.tiles.get(key);if(tile)return tile;
    // A stroke is authored input: tracking its tiles is never refused. The
    // before/coverage record is what keeps cancel() and undo exact.
    this.bytes+=TILE*TILE*8+64;const existing=this.store.get(tx,ty);
    tile={tx,ty,before:existing?existing.pixels.slice():null,coverage:new Float32Array(TILE*TILE),pixels:this.store.writable(tx,ty).pixels};this.tiles.set(key,tile);return tile;
  }
  dab(p) {
    const pressure=clamp(p.pressure??1);let radius=this.size*(this.pressureSize?Math.max(.05,pressure**this.sizeCurve):1)/2;
    if(this.texture>0)radius*=1+(this.nextRand()*2-1)*.1;
    const left=Math.floor(p.x-radius),top=Math.floor(p.y-radius),right=Math.ceil(p.x+radius),bottom=Math.ceil(p.y+radius);
    const opacity=this.opacity*(this.pressureOpacity?pressure**this.opacityCurve:1);
    // Visit tiles once per dab, not once per pixel. Pressure may add paint,
    // but releasing pressure must never lift paint already laid in this stroke.
    for(let ty=Math.floor(top/TILE);ty*TILE<bottom;ty++)for(let tx=Math.floor(left/TILE);tx*TILE<right;tx++){
      let tile;
      for(let y=Math.max(top,ty*TILE);y<Math.min(bottom,ty*TILE+TILE);y++)for(let x=Math.max(left,tx*TILE);x<Math.min(right,tx*TILE+TILE);x++){
        const dx=x+.5-p.x,dy=y+.5-p.y,distance2=dx*dx+dy*dy;if(distance2>=radius*radius)continue;
        const distance=Math.sqrt(distance2);
        const edge=this.hardness>=.999?(distance2<=(radius-1)*(radius-1)&&radius>=1?1:clamp(radius-distance)):(t=>t*t*(3-2*t))(clamp((1-distance/radius)/(1-this.hardness)));
        tile??=this.tile(tx,ty);const q=(y-ty*TILE)*TILE+x-tx*TILE,j=q*4;
        const grain=this.texture>0?1-this.texture*(1-hashPixel(x,y,this.seed)):1;
        const previous=tile.coverage[q];tile.coverage[q]=Math.max(previous,previous+(opacity-previous)*edge*this.flow*grain);
        const contribution=tile.coverage[q],alpha=tile.before?tile.before[j+3]/255:0;
        if(this.erase){tile.pixels[j+3]=Math.round(alpha*(1-contribution)*255);if(tile.before)for(let c=0;c<3;c++)tile.pixels[j+c]=tile.before[j+c];}
        else{const out=contribution+alpha*(1-contribution);tile.pixels[j+3]=Math.round(out*255);for(let c=0;c<3;c++)tile.pixels[j+c]=out?Math.round((this.color[c]*contribution+(tile.before?tile.before[j+c]:0)*alpha*(1-contribution))/out):0;}
      }
      if(tile)this.dirtyTiles.add(tileKey(tx,ty));
    }
    this.lastDab={x:p.x,y:p.y};
    if(right>left&&bottom>top)this.dirty=this.dirty?{x:Math.min(this.dirty.x,left),y:Math.min(this.dirty.y,top),right:Math.max(this.dirty.right,right),bottom:Math.max(this.dirty.bottom,bottom)}:{x:left,y:top,right,bottom};
  }
  /** Smoothed point: weighted centroid of the distance-windowed raw tail.
   * Linear-ramp weights (newest heaviest) keep the average trailing the input
   * by roughly half the window while staying responsive at every speed. */
  smoothed(){
    return this.smoother.value();
  }
  sample(input) {
    if(this.closed)throw new Error('The stroke has already ended.');
    if(![input.x,input.y,input.pressure??1,input.time??0].every(Number.isFinite))return;
    const p={...input,pressure:input.pressure??1,time:input.time??0};
    this.rawLast=p;
    if(this.stabilization<=0){this.push(p);return;}
    this.smoother??=new DrawingSmoother(this.stabilization*48*this.pixelsPerUnit);
    this.push(this.smoother.add(p));
  }
  /** Push a path point: join it to the previous one with a quadratic midpoint
   * segment so every sample — smoothed or raw — produces a smooth curve. */
  push(p){
    if(!this.prevRaw){this.dab(p);this.prevRaw=p;this.prevMid=null;this.remaining=0;return;}
    const prev=this.prevRaw,mid={x:(prev.x+p.x)/2,y:(prev.y+p.y)/2,pressure:(prev.pressure+p.pressure)/2,time:(prev.time+p.time)/2};
    this.curve(this.prevMid??prev,prev,mid);
    this.prevRaw=p;this.prevMid=mid;
  }
  /** Dab along the quadratic Bézier a→b with control c, sampled by arc length
   * at the running `spacing`/`remaining` accumulator. */
  curve(a,c,b){
    const spacingAt=pressure=>Math.max(.25,this.size*this.spacingRatio*(this.pressureSize?Math.max(.05,clamp(pressure)**this.sizeCurve):1));
    const spacing=Math.min(spacingAt(a.pressure),spacingAt(c.pressure),spacingAt(b.pressure));
    const q=t=>{const u=1-t;return{x:u*u*a.x+2*u*t*c.x+t*t*b.x,y:u*u*a.y+2*u*t*c.y+t*t*b.y,pressure:u*u*a.pressure+2*u*t*c.pressure+t*t*b.pressure,time:u*u*a.time+2*u*t*c.time+t*t*b.time};};
    const steps=Math.max(4,Math.min(64,Math.ceil((Math.hypot(c.x-a.x,c.y-a.y)+Math.hypot(b.x-c.x,b.y-c.y))/(spacing/2))));
    let prev=a;
    for(let i=1;i<=steps;i++){
      const p=q(i/steps),seg=Math.hypot(p.x-prev.x,p.y-prev.y);
      // Carry a fractional dab phase, not a distance at the previous tip size.
      // The smaller endpoint spacing keeps pressure ramps continuous too.
      const step= Math.min(spacingAt(prev.pressure),spacingAt(p.pressure));
      let pos=(1-this.remaining)*step;
      while(seg>0&&seg>=pos){const t=pos/seg;this.dab({x:prev.x+(p.x-prev.x)*t,y:prev.y+(p.y-prev.y)*t,pressure:prev.pressure+(p.pressure-prev.pressure)*t,time:prev.time+(p.time-prev.time)*t});pos+=step;}
      this.remaining=(this.remaining+seg/step)%1;prev=p;
    }
  }
  cancel(){if(this.closed)return;for(const tile of this.tiles.values()){if(tile.before)this.store.set(tile.tx,tile.ty,tile.before);else this.store.delete(tile.tx,tile.ty);}this.closed=true;}
  finish(){if(this.closed)return[];this.closed=true;
    // Drain the averaging tail: the smoothed point converges to the last
    // input, so the curve catches up smoothly instead of jumping.
    const smoother=this.smoother;
    if(smoother)while(smoother.size>1){smoother.shift();this.push(this.smoothed());}
    if(this.prevRaw&&this.rawLast){
      // Close the final half-segment, then land the exact endpoint dab.
      if(this.rawLast.x!==this.prevRaw.x||this.rawLast.y!==this.prevRaw.y)this.push(this.rawLast);
      this.push(this.prevRaw);
      if(this.lastDab?.x!==this.rawLast.x||this.lastDab?.y!==this.rawLast.y)this.dab(this.rawLast);
    }
    const changes=[];for(const tile of this.tiles.values()){
      const after=this.store.get(tile.tx,tile.ty)?.pixels??null;
      if(tile.before&&after&&sideEqual(tile.before,after))continue;
      if(!tile.before&&!after)continue;
      const before=normSide(compactTile(tile.before)),afterCompact=normSide(compactTile(after));
      if(before===null&&afterCompact===null)continue;
      changes.push({tx:tile.tx,ty:tile.ty,before,after:afterCompact});
    }
    return changes;
  }
}

/** Flood within an explicit pixel-space bounds rect. Transparency ignores RGB
 * of fully transparent pixels. Tolerance compares premultiplied RGBA to avoid
 * invisible RGB halos. */
export function floodTiles(store,{x,y,color=[0,0,0,255],tolerance=16,expansion=0,gap=0,bounds,source}={}) {
  if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isInteger)||bounds.width<1||bounds.height<1||bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('Invalid fill bounds.');
  const {width,height}=bounds,count=width*height;
  x=Math.floor(x)-bounds.x;y=Math.floor(y)-bounds.y;if(x<0||y<0||x>=width||y>=height)return;
  if(![tolerance,expansion,gap].every(Number.isFinite)||color.length!==4||!color.every(Number.isFinite))throw new Error('Invalid fill options.');
  tolerance=clamp(tolerance,0,255);expansion=Math.round(clamp(expansion,0,16));gap=Math.round(clamp(gap,0,8));
  const pixels=store.readRect(bounds.x,bounds.y,width,height),origin=source?new Uint8ClampedArray(source):pixels;
  const eligible=new Uint8Array(count),mask=new Uint8Array(count),queue=new Uint32Array(count),target=(y*width+x)*4,ta=origin[target+3]/255;
  const tr=origin[target]*ta,tg=origin[target+1]*ta,tb=origin[target+2]*ta,ta255=origin[target+3];
  for(let p=0;p<count;p++){const i=p*4,a=origin[i+3]/255;eligible[p]=Math.abs(origin[i]*a-tr)<=tolerance&&Math.abs(origin[i+1]*a-tg)<=tolerance&&Math.abs(origin[i+2]*a-tb)<=tolerance&&Math.abs(origin[i+3]-ta255)<=tolerance?1:0;}
  // Close gaps by dilating nonmatching boundaries, flood, then restore edges.
  function expand(input,steps){let current=input;for(let step=0;step<steps;step++){const next=current.slice();for(let p=0;p<count;p++)if(current[p]){if(p%width)next[p-1]=1;if(p%width<width-1)next[p+1]=1;if(p>=width)next[p-width]=1;if(p+width<count)next[p+width]=1;}current=next;}return current;}
  const blocked=gap?expand(eligible.map(n=>1-n),gap):null;
  let head=0,tail=0;const start=y*width+x;if(blocked?.[start])return;queue[tail++]=start;mask[start]=1;
  while(head<tail){const p=queue[head++];
    if(p%width&&!mask[p-1]&&eligible[p-1]&&!blocked?.[p-1]){mask[p-1]=1;queue[tail++]=p-1;}
    if(p%width<width-1&&!mask[p+1]&&eligible[p+1]&&!blocked?.[p+1]){mask[p+1]=1;queue[tail++]=p+1;}
    if(p>=width&&!mask[p-width]&&eligible[p-width]&&!blocked?.[p-width]){mask[p-width]=1;queue[tail++]=p-width;}
    if(p+width<count&&!mask[p+width]&&eligible[p+width]&&!blocked?.[p+width]){mask[p+width]=1;queue[tail++]=p+width;}
  }
  const grown=expand(mask,gap+expansion),out32=new Uint32Array(pixels.buffer),word=(color[3]<<24|color[2]<<16|color[1]<<8|color[0])>>>0,touched=new Set();
  for(let py=0;py<height;py++){let x0=-1,x1=-1;const row=py*width;
    for(let px=0;px<width;px++){const p=row+px;if(grown[p]){out32[p]=word;if(x0<0)x0=px;x1=px;}}
    if(x0>=0)for(let tx=Math.floor((bounds.x+x0)/TILE);tx*TILE<bounds.x+x1+1;tx++)touched.add(tileKey(tx,Math.floor((bounds.y+py)/TILE)));
  }
  for(const key of touched){const [tx,ty]=key.split(',').map(Number),tile=store.writable(tx,ty),ox=tx*TILE-bounds.x,oy=ty*TILE-bounds.y;
    for(let py=Math.max(0,-oy);py<Math.min(TILE,height-oy);py++)tile.pixels.set(pixels.subarray(((py+oy)*width+Math.max(0,ox))*4,((py+oy)*width+Math.min(width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);}
}

/** A lasso mask allocated only around the polygon bounding box. */
export function lassoMask(points) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x0=Math.floor(Math.min(...xs)),y0=Math.floor(Math.min(...ys)),width=Math.ceil(Math.max(...xs))-x0,height=Math.ceil(Math.max(...ys))-y0;
  if(points.length>=3&&(![x0,y0,width,height].every(Number.isSafeInteger)||width*height>DRAWING_MAX_PIXELS))throw new Error('The selection exceeds 16 megapixels. Select a smaller region.');
  const mask=new Uint8Array(Math.max(0,width)*Math.max(0,height));
  if(points.length<3||width<1||height<1)return{x:x0,y:y0,width:Math.max(0,width),height:Math.max(0,height),mask};
  for(let y=0;y<height;y++){const crosses=[],wy=y0+y+.5;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>wy)!==(b.y>wy))crosses.push(a.x+(wy-a.y)*(b.x-a.x)/(b.y-a.y));}crosses.sort((a,b)=>a-b);for(let i=0;i+1<crosses.length;i+=2)for(let x=Math.max(0,Math.ceil(crosses[i]-.5-x0));x<Math.min(width,Math.ceil(crosses[i+1]-.5-x0));x++)mask[y*width+x]=1;}
  return{x:x0,y:y0,width,height,mask};
}
