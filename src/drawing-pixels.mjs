import {DRAWING_MAX_PIXELS} from './drawing-model.mjs';
import {TILE,TILE_BYTES,tileKey,TileStore} from './drawing-tiles.mjs';
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
const lum=(r,g,b)=>.3*r+.59*g+.11*b;
/** W3C non-separable SetLum/ClipColor on 0..255 channels. */
function setLum(r,g,b,l){const d=l-lum(r,g,b);r+=d;g+=d;b+=d;const L=lum(r,g,b),n=Math.min(r,g,b),x=Math.max(r,g,b);if(n<0){r=L+(r-L)*L/(L-n);g=L+(g-L)*L/(L-n);b=L+(b-L)*L/(L-n);}if(x>255){r=L+(r-L)*(255-L)/(x-L);g=L+(g-L)*(255-L)/(x-L);b=L+(b-L)*(255-L)/(x-L);}return [r,g,b];}
/** Separable blend functions B(Cb,Cs) on 0..255 channels. 'color' is
 * non-separable and handled with setLum; its entry here is unused. */
const blendChannel={multiply:(b,s)=>b*s/255,screen:(b,s)=>b+s-b*s/255,overlay:(b,s)=>b<=127.5?2*b*s/255:255-2*(255-b)*(255-s)/255,color:(b,s)=>s};
/** Deterministic pixel grain: pure function of integer pixel coords + seed. */
const hashPixel=(x,y,seed)=>{let h=(Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,974711))>>>0;h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967296;};
const ZERO_TILE=new Uint8ClampedArray(TILE_BYTES);
export const BRUSH_BLENDS=['normal','behind','multiply','screen','overlay','color'];
export const BRUSH_ANGLE_MODES=['fixed','direction','tilt'];

/** Clamped, validated brush settings shared by the stroke path (main thread)
 * and the dab rasterizer (stroke worker), so both agree on every extent. */
export function normalizeBrush({size=8,color=[0,0,0],opacity=1,flow=1,hardness=1,erase=false,pressureSize=true,pressureOpacity=false,pressureFlow=false,sizeCurve=1,opacityCurve=1,stabilization=0,spacingRatio=.12,texture=0,seed=0,pixelsPerUnit=1,roundness=1,angle=0,angleMode='fixed',blend='normal',alphaLock=false,scatter=0}={}){
  if(![size,opacity,flow,hardness,sizeCurve,opacityCurve,stabilization,spacingRatio,texture,pixelsPerUnit,roundness,angle,scatter].every(Number.isFinite)||!Array.isArray(color)||color.length!==3||!color.every(Number.isFinite))throw new Error('Invalid brush settings.');
  return {size:clamp(size,.5,8192),color:color.map(n=>clamp(n,0,255)),opacity:clamp(opacity),flow:clamp(flow),hardness:clamp(hardness),erase:Boolean(erase),pressureSize:Boolean(pressureSize),pressureOpacity:Boolean(pressureOpacity),pressureFlow:Boolean(pressureFlow),sizeCurve:clamp(sizeCurve,.1,4),opacityCurve:clamp(opacityCurve,.1,4),stabilization:clamp(stabilization,0,.95),spacingRatio:clamp(spacingRatio,.01,1),texture:clamp(texture),seed:seed>>>0,pixelsPerUnit:clamp(pixelsPerUnit,.01,64),roundness:clamp(roundness,.05,1),angle:((angle%360)+360)%360,angleMode:BRUSH_ANGLE_MODES.includes(angleMode)?angleMode:'fixed',blend:BRUSH_BLENDS.includes(blend)?blend:'normal',alphaLock:Boolean(alphaLock),scatter:clamp(scatter,0,4)};
}
/** Radius of a dab at this pressure before texture jitter. */
export function dabRadius(brush,pressure=1){return brush.size*(brush.pressureSize?Math.max(.05,clamp(pressure)**brush.sizeCurve):1)/2;}
/** Conservative pixel bounds [x0,y0,x1,y1) of a dab, including jitter and
 * scatter. Callers seed exactly the tiles these bounds touch. */
export function dabExtent(brush,dab){const r=dabRadius(brush,dab.pressure??1)*(brush.texture>0?1.1:1)+1+brush.scatter*brush.size/2;return [Math.floor(dab.x-r),Math.floor(dab.y-r),Math.ceil(dab.x+r),Math.ceil(dab.y+r)];}
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,pressure:a.pressure+(b.pressure-a.pressure)*t,time:a.time+(b.time-a.time)*t,ax:a.ax+(b.ax-a.ax)*t,ay:a.ay+(b.ay-a.ay)*t});
const tileId=(tx,ty)=>(tx+1048576)*2097152+(ty+1048576);

/** Input path → evenly spaced dabs. Stabilization is a distance-windowed
 * trailing average over the raw path, so every sample yields output with no
 * dead zone; consecutive pushed points are joined by quadratic midpoint
 * segments, which keeps corners smooth at zero lag, and the stroke still ends
 * exactly on the final input. It runs on the main thread so the caller knows
 * every dab's extent before any pixel work is dispatched. */
export class StrokePath {
  constructor(settings,emit){const b=normalizeBrush(settings);Object.assign(this,{size:b.size,spacingRatio:b.spacingRatio,stabilization:b.stabilization,pixelsPerUnit:b.pixelsPerUnit,emit,count:0});}
  out(p){this.lastDab=p;this.count++;p=lerp(p,p,0);p.dir=this.dir??0;this.emit(p);}
  /** Smoothed point: weighted centroid of the distance-windowed raw tail.
   * Linear-ramp weights (newest heaviest) keep the average trailing the input
   * by roughly half the window while staying responsive at every speed. */
  smoothed(){
    const tail=this.tail,out={x:0,y:0,pressure:0,time:0,ax:0,ay:0};let sum=0;
    for(let i=0;i<tail.length;i++){const w=i+1,p=tail[i];sum+=w;out.x+=p.x*w;out.y+=p.y*w;out.pressure+=p.pressure*w;out.time+=p.time*w;out.ax+=p.ax*w;out.ay+=p.ay*w;}
    out.x/=sum;out.y/=sum;out.pressure/=sum;out.time/=sum;out.ax/=sum;out.ay/=sum;return out;
  }
  sample(input) {
    if(this.closed)throw new Error('The stroke has already ended.');
    if(![input.x,input.y,input.pressure??1,input.time??0].every(Number.isFinite))return;
    const p={x:input.x,y:input.y,pressure:input.pressure??1,time:input.time??0,ax:Number.isFinite(input.ax)?input.ax:0,ay:Number.isFinite(input.ay)?input.ay:0};
    this.rawLast=p;
    if(this.stabilization<=0){this.push(p);return;}
    const tail=this.tail??=[],window=this.stabilization*48*this.pixelsPerUnit;
    tail.push(p);
    // Trim the tail to a window of path length, keeping at least two samples.
    let keep=1,arc=0;
    for(let i=tail.length-1;i>0;i--){arc+=Math.hypot(tail[i].x-tail[i-1].x,tail[i].y-tail[i-1].y);if(arc>window)break;keep++;}
    if(tail.length>Math.max(2,keep))tail.splice(0,tail.length-Math.max(2,keep));
    this.push(this.smoothed());
  }
  /** Push a path point: join it to the previous one with a quadratic midpoint
   * segment so every sample — smoothed or raw — produces a smooth curve. */
  push(p){
    if(!this.prevRaw){this.out(p);this.prevRaw=p;this.prevMid=null;this.remaining=0;return;}
    const prev=this.prevRaw,mid=lerp(prev,p,.5);
    this.curve(this.prevMid??prev,prev,mid);
    this.prevRaw=p;this.prevMid=mid;
  }
  /** Dab along the quadratic Bézier a→b with control c, sampled by arc length
   * at the running `spacing`/`remaining` accumulator. */
  curve(a,c,b){
    const spacing=Math.max(.25,this.size*this.spacingRatio);
    const q=t=>{const u=1-t,w0=u*u,w1=2*u*t,w2=t*t;return{x:w0*a.x+w1*c.x+w2*b.x,y:w0*a.y+w1*c.y+w2*b.y,pressure:w0*a.pressure+w1*c.pressure+w2*b.pressure,time:w0*a.time+w1*c.time+w2*b.time,ax:w0*a.ax+w1*c.ax+w2*b.ax,ay:w0*a.ay+w1*c.ay+w2*b.ay};};
    const steps=Math.max(4,Math.min(64,Math.ceil((Math.hypot(c.x-a.x,c.y-a.y)+Math.hypot(b.x-c.x,b.y-c.y))/(spacing/2))));
    let pos=spacing-this.remaining,prev=a,arc=0;
    for(let i=1;i<=steps;i++){
      const p=q(i/steps),seg=Math.hypot(p.x-prev.x,p.y-prev.y);
      if(seg>0)this.dir=Math.atan2(p.y-prev.y,p.x-prev.x);
      while(seg>0&&arc+seg>=pos){this.out(lerp(prev,p,(pos-arc)/seg));pos+=spacing;}
      arc+=seg;prev=p;
    }
    this.remaining=(this.remaining+arc)%spacing;
  }
  finish(){if(this.closed)return;this.closed=true;
    // Drain the averaging tail: the smoothed point converges to the last
    // input, so the curve catches up smoothly instead of jumping.
    const tail=this.tail;
    if(tail)while(tail.length>1){tail.shift();this.push(this.smoothed());}
    if(this.prevRaw&&this.rawLast){
      // Close the final half-segment, then land the exact endpoint dab.
      if(this.rawLast.x!==this.prevRaw.x||this.rawLast.y!==this.prevRaw.y)this.push(this.rawLast);
      this.push(this.prevRaw);
      if(this.lastDab?.x!==this.rawLast.x||this.lastDab?.y!==this.rawLast.y)this.out(this.rawLast);
    }
  }
}

/** Exact CPU raster with tile-local stroke coverage on an unbounded TileStore.
 * Opacity caps an entire stroke (indirect painting); flow accumulates dabs
 * without multiplying it. Blend modes composite the stroke's source colour
 * against the pixels the stroke first saw, alpha lock preserves their alpha,
 * and an optional selection mask clips coverage. `requireTile` lets a caller
 * refuse tiles it never supplied instead of painting over a blank guess. */
export class DrawingStroke {
  constructor(store,settings={},{requireTile,mask}={}) {
    if(!(store instanceof TileStore))throw new Error('Strokes draw into a tile store.');
    const brush=normalizeBrush(settings);
    Object.assign(this,brush,{store,brush,requireTile,mask:mask??settings.mask??null,maxBytes:settings.maxBytes??48*1024*1024,tiles:new Map(),bytes:256,dirty:null,dirtyTiles:new Set(),rand:brush.seed,dabs:0});
    this.path=new StrokePath(brush,p=>this.dab(p));
  }
  nextRand(){let t=this.rand=(this.rand+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
  tile(tx,ty) {
    const key=tileId(tx,ty);let tile=this.tiles.get(key);if(tile)return tile;
    this.requireTile?.(tx,ty);
    // A stroke is authored input: tracking its tiles is never refused. The
    // before/coverage record is what keeps cancel() and undo exact.
    this.bytes+=TILE*TILE*8+64;const existing=this.store.get(tx,ty);
    tile={tx,ty,before:existing?existing.pixels.slice():null,coverage:new Float32Array(TILE*TILE),pixels:this.store.writable(tx,ty).pixels};tile.src=tile.before??ZERO_TILE;this.tiles.set(key,tile);return tile;
  }
  /** Rasterize dabs precomputed by a StrokePath (the stroke worker's input). */
  dabList(list){if(this.closed)throw new Error('The stroke has already ended.');for(const p of list)this.dab(p);}
  dab(p) {
    this.dabs++;
    const pressure=clamp(p.pressure??1);let radius=dabRadius(this,pressure);
    if(this.texture>0)radius*=1+(this.nextRand()*2-1)*.1;
    let cx=p.x,cy=p.y;
    if(this.scatter>0){const a=this.nextRand()*Math.PI*2,d=this.nextRand()*this.scatter*this.size/2;cx+=Math.cos(a)*d;cy+=Math.sin(a)*d;}
    const opacity=this.opacity*(this.pressureOpacity?pressure**this.opacityCurve:1),flow=this.flow*(this.pressureFlow?pressure:1);
    this.lastDab={x:p.x,y:p.y};
    if(opacity<=0||flow<=0||radius<=0)return;
    const round=this.roundness<.999,theta=(this.angle*Math.PI/180)+(this.angleMode==='direction'?p.dir??0:this.angleMode==='tilt'&&(p.ax||p.ay)?Math.atan2(p.ay,p.ax):0);
    const cos=Math.cos(theta),sin=Math.sin(theta),inv=1/this.roundness;
    let hx=radius,hy=radius;
    if(round){const rb=radius*this.roundness;hx=Math.sqrt((radius*cos)**2+(rb*sin)**2);hy=Math.sqrt((radius*sin)**2+(rb*cos)**2);}
    const left=Math.floor(cx-hx),top=Math.floor(cy-hy),right=Math.ceil(cx+hx),bottom=Math.ceil(cy+hy);
    const r2=radius*radius,hard=this.hardness>=.999,inner=radius>=1?(radius-1)*(radius-1):-1,soft=1/Math.max(1e-6,1-this.hardness);
    const texture=this.texture,seed=this.seed,mask=this.mask,mode=this.erase?'erase':this.blend,lock=this.alphaLock&&mode!=='erase'&&mode!=='behind';
    const blend=mode==='normal'||mode==='erase'||mode==='behind'?null:blendChannel[mode],[sr,sg,sb]=this.color;
    // Visit tiles once per dab, not once per pixel. Pressure may add paint,
    // but releasing pressure must never lift paint already laid in this stroke.
    for(let ty=Math.floor(top/TILE);ty*TILE<bottom;ty++)for(let tx=Math.floor(left/TILE);tx*TILE<right;tx++){
      let tile=this.tiles.get(tileId(tx,ty));
      // Nothing to erase or recolour where the stroke found no pixels.
      if(!tile&&(mode==='erase'||lock)&&!this.store.has(tx,ty))continue;
      let cov=tile?.coverage,changed=false;
      const ox=tx*TILE,oy=ty*TILE,y0=Math.max(top,oy),y1=Math.min(bottom,oy+TILE);
      for(let y=y0;y<y1;y++){
        const dy=y+.5-cy;let x0=Math.max(left,ox),x1=Math.min(right,ox+TILE);
        if(!round){const span=r2-dy*dy;if(span<=0)continue;const w=Math.sqrt(span);x0=Math.max(x0,Math.floor(cx-w-.5));x1=Math.min(x1,Math.ceil(cx+w+.5));}
        const row=(y-oy)*TILE-ox;
        for(let x=x0;x<x1;x++){
          const q=row+x,previous=cov?cov[q]:0;
          // Saturated coverage cannot change: the common case under dense spacing.
          if(previous>=opacity)continue;
          let dx=x+.5-cx,ddy=dy;
          if(round){const u=dx*cos+ddy*sin;ddy=(ddy*cos-dx*sin)*inv;dx=u;}
          const d2=dx*dx+ddy*ddy;if(d2>=r2)continue;
          let edge;
          if(hard)edge=d2<=inner?1:clamp(radius-Math.sqrt(d2));
          else{const t=clamp((1-Math.sqrt(d2)/radius)*soft);edge=t*t*(3-2*t);}
          let e=edge*flow;
          if(texture>0)e*=1-texture*(1-hashPixel(x,y,seed));
          if(mask){const mx=x-mask.x,my=y-mask.y;e*=mx>=0&&my>=0&&mx<mask.width&&my<mask.height?mask.mask[my*mask.width+mx]/(mask.max??1):0;}
          if(e<=0)continue;
          if(!tile){tile=this.tile(tx,ty);cov=tile.coverage;}
          const c=previous+(opacity-previous)*e;cov[q]=c;changed=true;
          const j=q*4,src=tile.src,px=tile.pixels,ba=src[j+3]/255,br=src[j],bg=src[j+1],bb=src[j+2];
          if(mode==='erase'){px[j+3]=Math.round(ba*(1-c)*255);px[j]=br;px[j+1]=bg;px[j+2]=bb;continue;}
          if(mode==='behind'){const out=ba+c*(1-ba),k=c*(1-ba);px[j+3]=Math.round(out*255);px[j]=Math.round((br*ba+sr*k)/out);px[j+1]=Math.round((bg*ba+sg*k)/out);px[j+2]=Math.round((bb*ba+sb*k)/out);continue;}
          // Separable blend against the backdrop, weighted by backdrop alpha
          // (W3C compositing): Cs' = (1-ab)·Cs + ab·B(Cb,Cs).
          let r=sr,g=sg,b=sb;
          if(blend&&ba>0){
            let mr,mg,mb;
            if(mode==='color')[mr,mg,mb]=setLum(sr,sg,sb,lum(br,bg,bb));else{mr=blend(br,sr);mg=blend(bg,sg);mb=blend(bb,sb);}
            r=(1-ba)*sr+ba*mr;g=(1-ba)*sg+ba*mg;b=(1-ba)*sb+ba*mb;
          }
          if(lock){px[j+3]=src[j+3];px[j]=Math.round(br+(r-br)*c);px[j+1]=Math.round(bg+(g-bg)*c);px[j+2]=Math.round(bb+(b-bb)*c);continue;}
          const out=c+ba*(1-c),k=ba*(1-c);px[j+3]=Math.round(out*255);px[j]=Math.round((r*c+br*k)/out);px[j+1]=Math.round((g*c+bg*k)/out);px[j+2]=Math.round((b*c+bb*k)/out);
        }
      }
      if(changed)this.dirtyTiles.add(tile);
    }
    if(right>left&&bottom>top)this.dirty=this.dirty?{x:Math.min(this.dirty.x,left),y:Math.min(this.dirty.y,top),right:Math.max(this.dirty.right,right),bottom:Math.max(this.dirty.bottom,bottom)}:{x:left,y:top,right,bottom};
  }
  sample(input){if(this.closed)throw new Error('The stroke has already ended.');this.path.sample(input);}
  cancel(){if(this.closed)return;for(const tile of this.tiles.values()){if(tile.before)this.store.set(tile.tx,tile.ty,tile.before);else this.store.delete(tile.tx,tile.ty);}this.closed=true;}
  finish(){if(this.closed)return[];this.path.finish();this.closed=true;
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

/** Mark every pixel within Manhattan distance `k` of a set pixel — exactly `k`
 * steps of 4-neighbour dilation — restricted to `box` grown by k. One pass
 * suffices for k=1; larger k use a two-pass distance transform. */
function dilateL1(src,width,height,k,box){
  if(k<=0)return src;
  const x0=Math.max(0,box.x0-k),y0=Math.max(0,box.y0-k),x1=Math.min(width-1,box.x1+k),y1=Math.min(height-1,box.y1+k),out=new Uint8Array(width*height);
  if(k===1){
    for(let y=y0;y<=y1;y++){const row=y*width;for(let x=x0;x<=x1;x++){const p=row+x;if(src[p]||(x>0&&src[p-1])||(x<width-1&&src[p+1])||(y>0&&src[p-width])||(y<height-1&&src[p+width]))out[p]=1;}}
    return out;
  }
  const cap=k+1,d=out;
  for(let y=y0;y<=y1;y++){const row=y*width;for(let x=x0;x<=x1;x++){const p=row+x;let v=src[p]?0:cap;if(v){if(x>x0&&d[p-1]+1<v)v=d[p-1]+1;if(y>y0&&d[p-width]+1<v)v=d[p-width]+1;}d[p]=v;}}
  for(let y=y1;y>=y0;y--){const row=y*width;for(let x=x1;x>=x0;x--){const p=row+x;let v=d[p];if(!v)continue;if(x<x1&&d[p+1]+1<v)v=d[p+1]+1;if(y<y1&&d[p+width]+1<v)v=d[p+width]+1;d[p]=v;}}
  for(let y=y0;y<=y1;y++){const row=y*width;for(let x=x0;x<=x1;x++){const p=row+x;d[p]=d[p]<=k?1:0;}}
  return d;
}
/** Flood within an explicit pixel-space bounds rect. Transparency ignores RGB
 * of fully transparent pixels. Tolerance compares premultiplied RGBA to avoid
 * invisible RGB halos. Gap closing blocks pixels within `gap` of a boundary,
 * floods by scanline spans, then grows the region back by gap + expansion.
 * Work runs per tile: absent tiles classify in one step, and fully covered
 * tiles are written as compact uniform tiles. `clip` (a selection mask)
 * confines both the flood and its growth; `select` returns the region as a
 * mask instead of painting it (the magic wand). */
export function floodTiles(store,{x,y,color=[0,0,0,255],tolerance=16,expansion=0,gap=0,bounds,source,clip=null,select=false}={}) {
  if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isInteger)||bounds.width<1||bounds.height<1||bounds.width*bounds.height>DRAWING_MAX_PIXELS)throw new Error('Invalid fill bounds.');
  const {width,height}=bounds,count=width*height;
  x=Math.floor(x)-bounds.x;y=Math.floor(y)-bounds.y;if(x<0||y<0||x>=width||y>=height)return;
  if(![tolerance,expansion,gap].every(Number.isFinite)||color.length!==4||!color.every(Number.isFinite))throw new Error('Invalid fill options.');
  tolerance=clamp(tolerance,0,255);expansion=Math.round(clamp(expansion,0,16));gap=Math.round(clamp(gap,0,8));
  const origin=source?new Uint8ClampedArray(source):null;
  const sample=(px,py)=>{if(origin)return origin.subarray((py*width+px)*4,(py*width+px)*4+4);return store.pixel(bounds.x+px,bounds.y+py);};
  // Premultiplied comparison in integers: |c·a/255 − t| ≤ tol ⇔ |c·a − t·255| ≤ tol·255.
  const t=sample(x,y),ta=t[3],tr=t[0]*ta,tg=t[1]*ta,tb=t[2]*ta,tol=tolerance*255;
  const eligible=(r,g,b,a)=>{if(Math.abs(a-ta)>tolerance)return 0;const dr=r*a-tr,dg=g*a-tg,db=b*a-tb;return dr<=tol&&dr>=-tol&&dg<=tol&&dg>=-tol&&db<=tol&&db>=-tol?1:0;};
  const open=new Uint8Array(count),empty=eligible(0,0,0,0);
  if(origin){for(let p=0,i=0;p<count;p++,i+=4)open[p]=eligible(origin[i],origin[i+1],origin[i+2],origin[i+3]);}
  else for(const [tx,ty] of TileStore.tilesInRect(bounds.x,bounds.y,width,height)){
    const tile=store.get(tx,ty),ox=tx*TILE-bounds.x,oy=ty*TILE-bounds.y,sx=Math.max(0,-ox),ex=Math.min(TILE,width-ox),sy=Math.max(0,-oy),ey=Math.min(TILE,height-oy);
    if(!tile){if(empty)for(let py=sy;py<ey;py++){const row=(py+oy)*width+ox;open.fill(1,row+sx,row+ex);}continue;}
    const src=tile.pixels;
    for(let py=sy;py<ey;py++){const row=(py+oy)*width+ox;for(let px=sx,i=(py*TILE+sx)*4;px<ex;px++,i+=4)open[row+px]=eligible(src[i],src[i+1],src[i+2],src[i+3]);}
  }
  // Close gaps by blocking pixels near nonmatching boundaries.
  if(gap){
    let closedCount=0;for(let p=0;p<count;p++)closedCount+=1-open[p];
    if(closedCount*(2*gap*gap+2*gap+1)<4*count){
      // Sparse boundaries (typical line art): stamp a diamond around each one.
      const blocked=new Uint8Array(count);
      for(let p=0;p<count;p++){if(open[p])continue;const px=p%width,py=(p-px)/width;
        for(let dy=-gap;dy<=gap;dy++){const yy=py+dy;if(yy<0||yy>=height)continue;const w=gap-Math.abs(dy),row=yy*width;blocked.fill(1,row+Math.max(0,px-w),row+Math.min(width-1,px+w)+1);}}
      for(let p=0;p<count;p++)if(blocked[p])open[p]=0;
    }else{const closed=new Uint8Array(count);for(let p=0;p<count;p++)closed[p]=1-open[p];const blocked=dilateL1(closed,width,height,gap,{x0:0,y0:0,x1:width-1,y1:height-1});for(let p=0;p<count;p++)if(blocked[p])open[p]=0;}
  }
  const clipAt=clip?(p=>{const cx=p%width+bounds.x-clip.x,cy=(p-p%width)/width+bounds.y-clip.y;return cx>=0&&cy>=0&&cx<clip.width&&cy<clip.height?clip.mask[cy*clip.width+cx]:0;}):null;
  if(clipAt)for(let p=0;p<count;p++)if(open[p]&&!clipAt(p))open[p]=0;
  const start=y*width+x;if(!open[start])return select?null:undefined;
  const mask=new Uint8Array(count),stack=[start],box={x0:x,y0:y,x1:x,y1:y};
  while(stack.length){
    const p=stack.pop();if(mask[p]||!open[p])continue;
    const row=p-p%width,ry=row/width;let l=p,r=p;
    while(l>row&&open[l-1]&&!mask[l-1])l--;
    while(r<row+width-1&&open[r+1]&&!mask[r+1])r++;
    mask.fill(1,l,r+1);
    if(l-row<box.x0)box.x0=l-row;if(r-row>box.x1)box.x1=r-row;if(ry<box.y0)box.y0=ry;if(ry>box.y1)box.y1=ry;
    for(const next of [row-width,row+width]){
      if(next<0||next>=count)continue;
      const off=next-row;let inRun=false;
      for(let q=l+off;q<=r+off;q++){if(open[q]&&!mask[q]){if(!inRun){stack.push(q);inRun=true;}}else inRun=false;}
    }
  }
  const k=gap+expansion,grown=dilateL1(mask,width,height,k,box),word=(color[3]<<24|color[2]<<16|color[1]<<8|color[0])>>>0;
  const gx0=Math.max(0,box.x0-k),gy0=Math.max(0,box.y0-k),gx1=Math.min(width-1,box.x1+k),gy1=Math.min(height-1,box.y1+k);
  if(clipAt)for(let py=gy0;py<=gy1;py++)for(let px=gx0;px<=gx1;px++){const p=py*width+px;if(grown[p]&&!clipAt(p))grown[p]=0;}
  if(select){const w=gx1-gx0+1,h=gy1-gy0+1,out=new Uint8Array(w*h);for(let py=0;py<h;py++)out.set(grown.subarray((py+gy0)*width+gx0,(py+gy0)*width+gx0+w),py*w);return cropMask({x:bounds.x+gx0,y:bounds.y+gy0,width:w,height:h,mask:out});}
  const uniform=new Uint8ClampedArray([color[0],color[1],color[2],color[3]]);
  for(const [tx,ty] of TileStore.tilesInRect(bounds.x+gx0,bounds.y+gy0,gx1-gx0+1,gy1-gy0+1)){
    const ox=tx*TILE-bounds.x,oy=ty*TILE-bounds.y,sx=Math.max(0,-ox),ex=Math.min(TILE,width-ox),sy=Math.max(0,-oy),ey=Math.min(TILE,height-oy);
    let filled=0;
    for(let py=sy;py<ey;py++){const row=(py+oy)*width+ox;for(let px=sx;px<ex;px++)filled+=grown[row+px];}
    if(!filled)continue;
    // A tile the fill covers completely becomes one uniform colour.
    if(filled===TILE*TILE){store.set(tx,ty,uniform);continue;}
    const tile=store.writable(tx,ty),out32=new Uint32Array(tile.pixels.buffer,tile.pixels.byteOffset,TILE*TILE);
    for(let py=sy;py<ey;py++){const row=(py+oy)*width+ox;for(let px=sx;px<ex;px++)if(grown[row+px])out32[py*TILE+px]=word;}
  }
}

/** A lasso mask allocated only around the polygon bounding box. */
export function lassoMask(points) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x0=Math.floor(Math.min(...xs)),y0=Math.floor(Math.min(...ys)),width=Math.ceil(Math.max(...xs))-x0,height=Math.ceil(Math.max(...ys))-y0;
  const mask=new Uint8Array(Math.max(0,width)*Math.max(0,height));
  if(points.length<3||width<1||height<1)return{x:x0,y:y0,width:Math.max(0,width),height:Math.max(0,height),mask};
  for(let y=0;y<height;y++){const crosses=[],wy=y0+y+.5;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>wy)!==(b.y>wy))crosses.push(a.x+(wy-a.y)*(b.x-a.x)/(b.y-a.y));}crosses.sort((a,b)=>a-b);for(let i=0;i+1<crosses.length;i+=2)for(let x=Math.max(0,Math.ceil(crosses[i]-.5-x0));x<Math.min(width,Math.ceil(crosses[i+1]-.5-x0));x++)mask[y*width+x]=1;}
  return{x:x0,y:y0,width,height,mask};
}

/** Selection masks are {x,y,width,height,mask:Uint8Array} in cel pixel space,
 * one byte per pixel (0 or 1). */
export const rectPoints=(a,b)=>{const x0=Math.min(a.x,b.x),y0=Math.min(a.y,b.y),x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];};
export const ellipsePoints=(a,b,n=96)=>{const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;return Array.from({length:n},(_,i)=>({x:cx+Math.cos(i/n*Math.PI*2)*rx,y:cy+Math.sin(i/n*Math.PI*2)*ry}));};
export const maskCount=m=>{let n=0;if(m)for(let i=0;i<m.mask.length;i++)n+=m.mask[i];return n;};
/** Rectangle mask covering `rect` entirely. */
export function rectMask(rect){return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,mask:new Uint8Array(rect.width*rect.height).fill(1)};}
/** Combine two masks: replace, add (union), subtract (a minus b) or intersect.
 * The result is cropped to its occupied bounding box, or null when empty. */
export function combineMasks(a,b,mode='replace'){
  if(mode==='replace'||!a)return mode==='subtract'||mode==='intersect'?null:cropMask(b);
  if(!b)return mode==='intersect'?null:cropMask(a);
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),width=Math.max(a.x+a.width,b.x+b.width)-x,height=Math.max(a.y+a.height,b.y+b.height)-y;
  const out=new Uint8Array(width*height),at=(m,px,py)=>{const mx=px-m.x,my=py-m.y;return mx>=0&&my>=0&&mx<m.width&&my<m.height?m.mask[my*m.width+mx]:0;};
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){const u=at(a,px+x,py+y),v=at(b,px+x,py+y);out[py*width+px]=mode==='add'?(u|v):mode==='subtract'?(u&&!v?1:0):(u&v);}
  return cropMask({x,y,width,height,mask:out});
}
/** Invert a mask within `bounds` (the canvas region selections can reach). */
export function invertMask(m,bounds){
  const out=new Uint8Array(bounds.width*bounds.height).fill(1);
  if(m)for(let py=0;py<m.height;py++)for(let px=0;px<m.width;px++){if(!m.mask[py*m.width+px])continue;const x=px+m.x-bounds.x,y=py+m.y-bounds.y;if(x>=0&&y>=0&&x<bounds.width&&y<bounds.height)out[y*bounds.width+x]=0;}
  return cropMask({...bounds,mask:out});
}
export function cropMask(m){
  if(!m)return null;let x0=m.width,y0=m.height,x1=-1,y1=-1;
  for(let py=0;py<m.height;py++){const row=py*m.width;for(let px=0;px<m.width;px++)if(m.mask[row+px]){if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;y1=py;}}
  if(x1<0)return null;if(x0===0&&y0===0&&x1===m.width-1&&y1===m.height-1)return m;
  const width=x1-x0+1,height=y1-y0+1,mask=new Uint8Array(width*height);
  for(let py=0;py<height;py++)mask.set(m.mask.subarray((py+y0)*m.width+x0,(py+y0)*m.width+x0+width),py*width);
  return {x:m.x+x0,y:m.y+y0,width,height,mask};
}
/** Boundary segments between selected and unselected pixels as flat
 * [x0,y0,x1,y1,…] runs in pixel space, merged along rows and columns, or null
 * when the outline exceeds `limit` segments (callers draw the bounds instead). */
export function maskEdges(m,limit=250000){
  if(!m)return null;const {width:w,height:h}=m,at=(px,py)=>px>=0&&py>=0&&px<w&&py<h?m.mask[py*w+px]:0,out=[];
  for(let py=0;py<=h;py++){let start=-1;for(let px=0;px<=w;px++){const edge=px<w&&at(px,py)!==at(px,py-1);if(edge&&start<0)start=px;else if(!edge&&start>=0){out.push(m.x+start,m.y+py,m.x+px,m.y+py);start=-1;if(out.length>limit*4)return null;}}}
  for(let px=0;px<=w;px++){let start=-1;for(let py=0;py<=h;py++){const edge=py<h&&at(px,py)!==at(px-1,py);if(edge&&start<0)start=py;else if(!edge&&start>=0){out.push(m.x+px,m.y+start,m.x+px,m.y+py);start=-1;if(out.length>limit*4)return null;}}}
  return out;
}
/** Paint `color` [r,g,b,a] over every selected pixel (source-over). */
export function fillMaskTiles(store,{mask,color}){
  const [r,g,b,a]=color.map(n=>clamp(n,0,255)),alpha=a/255;if(!mask||!alpha)return;
  for(const [tx,ty] of TileStore.tilesInRect(mask.x,mask.y,mask.width,mask.height)){
    const ox=tx*TILE,oy=ty*TILE;let tile=null;
    for(let py=Math.max(0,mask.y-oy);py<Math.min(TILE,mask.y+mask.height-oy);py++)for(let px=Math.max(0,mask.x-ox);px<Math.min(TILE,mask.x+mask.width-ox);px++){
      if(!mask.mask[(py+oy-mask.y)*mask.width+px+ox-mask.x])continue;
      tile??=store.writable(tx,ty);const j=(py*TILE+px)*4,p=tile.pixels,ba=p[j+3]/255,out=alpha+ba*(1-alpha),k=ba*(1-alpha);
      p[j]=Math.round((r*alpha+p[j]*k)/out);p[j+1]=Math.round((g*alpha+p[j+1]*k)/out);p[j+2]=Math.round((b*alpha+p[j+2]*k)/out);p[j+3]=Math.round(out*255);
    }
  }
}
