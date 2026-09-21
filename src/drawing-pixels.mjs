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
  constructor(store,{size=8,color=[0,0,0],opacity=1,flow=1,hardness=1,erase=false,pressureSize=true,pressureOpacity=false,sizeCurve=1,opacityCurve=1,stabilization=0,spacingRatio=.12,texture=0,seed=0,pixelsPerUnit=1,maxBytes=48*1024*1024,workingBytes=768*1024*1024}={}) {
    if(!(store instanceof TileStore))throw new Error('Strokes draw into a tile store.');
    if(![size,opacity,flow,hardness,sizeCurve,opacityCurve,stabilization,spacingRatio,texture,pixelsPerUnit].every(Number.isFinite)||!Array.isArray(color)||color.length!==3||!color.every(Number.isFinite))throw new Error('Invalid brush settings.');
    Object.assign(this,{store,size:clamp(size,.5,8192),color:color.map(n=>clamp(n,0,255)),opacity:clamp(opacity),flow:clamp(flow),hardness:clamp(hardness),erase,pressureSize,pressureOpacity,sizeCurve:clamp(sizeCurve,.1,4),opacityCurve:clamp(opacityCurve,.1,4),stabilization:clamp(stabilization,0,.95),spacingRatio:clamp(spacingRatio,.01,1),texture:clamp(texture),seed:seed>>>0,pixelsPerUnit:clamp(pixelsPerUnit,.01,64),maxBytes,workingBytes,tiles:new Map(),bytes:256,dirty:null,dirtyTiles:new Set(),rand:seed>>>0});
  }
  nextRand(){let t=this.rand=(this.rand+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
  tile(tx,ty) {
    const key=tileKey(tx,ty);let tile=this.tiles.get(key);if(tile)return tile;
    // Bound pixels, snapshots, coverage and reply copies before allocating.
    if((this.tiles.size+1)*TILE_BYTES*5>this.workingBytes)throw new Error('The stroke exceeds the drawing working memory limit.');
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
export const FILL_MAX_PIXELS=64*1024*1024;
export function floodTiles(store,{x,y,color=[0,0,0,255],tolerance=16,expansion=0,gap=0,bounds,source,maxBytes=768*1024*1024}={}) {
  if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)||bounds.width<1||bounds.height<1||bounds.width*bounds.height>FILL_MAX_PIXELS)throw new Error('Invalid fill bounds: the region must fit within 64 megapixels.');
  const {width,height}=bounds,count=width*height;
  x=Math.floor(x)-bounds.x;y=Math.floor(y)-bounds.y;if(x<0||y<0||x>=width||y>=height)return [];
  if(![tolerance,expansion,gap,maxBytes].every(Number.isFinite)||color.length!==4||!color.every(Number.isFinite)||source&&source.length!==count*4)throw new Error('Invalid fill options.');
  tolerance=clamp(tolerance,0,255);expansion=Math.round(clamp(expansion,0,16));gap=Math.round(clamp(gap,0,8));
  const tileCount=(Math.floor((bounds.x+width-1)/TILE)-Math.floor(bounds.x/TILE)+1)*(Math.floor((bounds.y+height-1)/TILE)-Math.floor(bounds.y/TILE)+1);
  // Reserve worst-case masks, output and undo before changing a pixel. The
  // source stays tiled; the scanline stack grows only when new spans appear.
  if(count*(gap?5:expansion?4:2)+tileCount*TILE_BYTES*3+16*1024*1024+(source?.byteLength??0)>maxBytes)throw new Error('The fill exceeds the drawing working memory limit.');
  const rgba=source?source.subarray((y*width+x)*4,(y*width+x)*4+4):store.pixel(x+bounds.x,y+bounds.y),ta=rgba[3]/255,tr=rgba[0]*ta,tg=rgba[1]*ta,tb=rgba[2]*ta;
  const matches=(r,g,b,a)=>Math.abs(r*a/255-tr)<=tolerance&&Math.abs(g*a/255-tg)<=tolerance&&Math.abs(b*a/255-tb)<=tolerance&&Math.abs(a-rgba[3])<=tolerance;
  const eligible=new Uint8Array(count);let allEligible=matches(0,0,0,0);
  if(source){for(let p=0;p<count;p++){const i=p*4;eligible[p]=+matches(source[i],source[i+1],source[i+2],source[i+3]);if(!eligible[p])allEligible=false;}}
  else{
    if(matches(0,0,0,0))eligible.fill(1);
    for(const tile of store){const ox=tile.tx*TILE-bounds.x,oy=tile.ty*TILE-bounds.y,p=tile.pixels;
      for(let py=Math.max(0,-oy);py<Math.min(TILE,height-oy);py++)for(let px=Math.max(0,-ox);px<Math.min(TILE,width-ox);px++){const i=(py*TILE+px)*4;const match=matches(p[i],p[i+1],p[i+2],p[i+3]);eligible[(oy+py)*width+ox+px]=+match;if(!match)allEligible=false;}}
  }
  if(!allEligible)allEligible=eligible.every(Boolean);
  function expand(input,steps){let current=input;for(let step=0;step<steps;step++){const next=current.slice();for(let p=0;p<count;p++)if(current[p]){if(p%width)next[p-1]=1;if(p%width<width-1)next[p+1]=1;if(p>=width)next[p-width]=1;if(p+width<count)next[p+width]=1;}current=next;}return current;}
  const mask=allEligible?null:new Uint8Array(count);
  const blocked=gap&&!allEligible?expand(eligible.map(n=>1-n),gap):null,open=p=>eligible[p]&&!mask[p]&&!blocked?.[p];
  const start=y*width+x;if(!allEligible&&!open(start))return [];
  let stack=new Uint32Array(1024),length=0;
  const push=p=>{if(length===stack.length){if(stack.byteLength>=16*1024*1024)throw new Error('The fill is too fragmented for the drawing working memory limit.');const next=new Uint32Array(stack.length*2);next.set(stack);stack=next;}stack[length++]=p;};
  if(!allEligible)push(start);
  while(length){let p=stack[--length];if(!open(p))continue;const row=Math.floor(p/width)*width,end=row+width;while(p>row&&open(p-1))p--;
    let above=false,below=false;
    for(;p<end&&open(p);p++){mask[p]=1;const up=p>=width&&open(p-width),down=p+width<count&&open(p+width);if(up&&!above)push(p-width);if(down&&!below)push(p+width);above=up;below=down;}
  }
  const grown=allEligible?null:expand(mask,gap+expansion),before=new Map(),word=new Uint32Array(Uint8ClampedArray.from(color).buffer)[0];
  for(const [tx,ty] of TileStore.tilesInRect(bounds.x,bounds.y,width,height)){
    const ox=tx*TILE-bounds.x,oy=ty*TILE-bounds.y;let output=null;
    if(allEligible&&ox>=0&&oy>=0&&ox+TILE<=width&&oy+TILE<=height){
      const old=store.get(tx,ty)?.pixels;if(old&&new Uint32Array(old.buffer,old.byteOffset,old.byteLength/4).every(n=>n===word))continue;
      before.set(tileKey(tx,ty),old?.slice()??null);new Uint32Array(store.writable(tx,ty).pixels.buffer).fill(word);continue;
    }
    for(let py=Math.max(0,-oy);py<Math.min(TILE,height-oy);py++)for(let px=Math.max(0,-ox);px<Math.min(TILE,width-ox);px++)if(allEligible||grown[(oy+py)*width+ox+px]){
      const i=(py*TILE+px)*4,old=output??store.get(tx,ty)?.pixels;
      if(color[0]===(old?.[i]??0)&&color[1]===(old?.[i+1]??0)&&color[2]===(old?.[i+2]??0)&&color[3]===(old?.[i+3]??0))continue;
      if(!output){before.set(tileKey(tx,ty),old?.slice()??null);output=store.writable(tx,ty).pixels;}output.set(color,i);
    }
  }
  return tileChanges(store,before);
}
