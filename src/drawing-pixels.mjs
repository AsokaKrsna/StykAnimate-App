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
export function tileChanges(store,beforeTiles,maxBytes) {
  const changes=[];let bytes=0;
  for(const [key,beforeValue] of beforeTiles){
    const [tx,ty]=key.split(',').map(Number),afterValue=store.get(tx,ty)?.pixels??null;
    if(beforeValue===null&&afterValue===null)continue;
    if(beforeValue&&afterValue&&sideEqual(beforeValue,afterValue))continue;
    const before=normSide(compactTile(beforeValue)),after=normSide(compactTile(afterValue));
    if(before===null&&after===null)continue;
    bytes+=(before?.byteLength??0)+(after?.byteLength??0)+64;if(bytes>maxBytes)throw new Error('This pixel edit exceeds the undo budget. Select a smaller area or use 1× resolution.');
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

/** Exact CPU raster with tile-local stroke coverage on an unbounded TileStore.
 * Opacity caps an entire stroke; flow accumulates dabs without multiplying it. */
export class DrawingStroke {
  constructor(store,{size=8,color=[0,0,0],opacity=1,flow=1,hardness=1,erase=false,pressureSize=true,pressureOpacity=false,sizeCurve=1,opacityCurve=1,stabilization=0,maxBytes=48*1024*1024}={}) {
    if(!(store instanceof TileStore))throw new Error('Strokes draw into a tile store.');
    if(![size,opacity,flow,hardness,sizeCurve,opacityCurve,stabilization].every(Number.isFinite)||!Array.isArray(color)||color.length!==3||!color.every(Number.isFinite))throw new Error('Invalid brush settings.');
    Object.assign(this,{store,size:clamp(size,.5,8192),color:color.map(n=>clamp(n,0,255)),opacity:clamp(opacity),flow:clamp(flow),hardness:clamp(hardness),erase,pressureSize,pressureOpacity,sizeCurve:clamp(sizeCurve,.1,4),opacityCurve:clamp(opacityCurve,.1,4),stabilization:clamp(stabilization,0,.95),maxBytes,tiles:new Map(),bytes:256,dirty:null});
  }
  tile(tx,ty) {
    const key=tileKey(tx,ty);let tile=this.tiles.get(key);if(tile)return tile;
    const cost=TILE*TILE*8+64;
    if(this.bytes+cost>this.maxBytes)throw new Error('This stroke exceeds the undo budget. Use shorter strokes or a smaller brush.');
    this.bytes+=cost;const existing=this.store.get(tx,ty);
    tile={tx,ty,before:existing?existing.pixels.slice():null,coverage:new Float32Array(TILE*TILE),pixels:this.store.writable(tx,ty).pixels};this.tiles.set(key,tile);return tile;
  }
  dab(p) {
    const pressure=clamp(p.pressure??1),radius=this.size*(this.pressureSize?Math.max(.05,pressure**this.sizeCurve):1)/2;
    const left=Math.floor(p.x-radius),top=Math.floor(p.y-radius),right=Math.ceil(p.x+radius),bottom=Math.ceil(p.y+radius);
    const opacity=this.opacity*(this.pressureOpacity?pressure**this.opacityCurve:1);
    // Visit tiles once per dab, not once per pixel. Pressure may add paint,
    // but releasing pressure must never lift paint already laid in this stroke.
    for(let ty=Math.floor(top/TILE);ty*TILE<bottom;ty++)for(let tx=Math.floor(left/TILE);tx*TILE<right;tx++){
      let tile;
      for(let y=Math.max(top,ty*TILE);y<Math.min(bottom,ty*TILE+TILE);y++)for(let x=Math.max(left,tx*TILE);x<Math.min(right,tx*TILE+TILE);x++){
        const dx=x+.5-p.x,dy=y+.5-p.y,distance2=dx*dx+dy*dy;if(distance2>=radius*radius)continue;
        const edge=this.hardness>=.999?(distance2<=(radius-1)*(radius-1)&&radius>=1?1:clamp(radius-Math.sqrt(distance2))):clamp((1-Math.sqrt(distance2)/radius)/(1-this.hardness));
        tile??=this.tile(tx,ty);const q=(y-ty*TILE)*TILE+x-tx*TILE,j=q*4;
        const previous=tile.coverage[q];tile.coverage[q]=Math.max(previous,previous+(opacity-previous)*edge*this.flow);
        const contribution=tile.coverage[q],alpha=tile.before?tile.before[j+3]/255:0;
        if(this.erase){tile.pixels[j+3]=Math.round(alpha*(1-contribution)*255);if(tile.before)for(let c=0;c<3;c++)tile.pixels[j+c]=tile.before[j+c];}
        else{const out=contribution+alpha*(1-contribution);tile.pixels[j+3]=Math.round(out*255);for(let c=0;c<3;c++)tile.pixels[j+c]=out?Math.round((this.color[c]*contribution+(tile.before?tile.before[j+c]:0)*alpha*(1-contribution))/out):0;}
      }
    }
    if(right>left&&bottom>top)this.dirty=this.dirty?{x:Math.min(this.dirty.x,left),y:Math.min(this.dirty.y,top),right:Math.max(this.dirty.right,right),bottom:Math.max(this.dirty.bottom,bottom)}:{x:left,y:top,right,bottom};
  }
  sample(input,{final=false}={}) {
    if(this.closed)throw new Error('The stroke has already ended.');
    if(![input.x,input.y,input.pressure??1,input.time??0].every(Number.isFinite))return;
    const p={...input,pressure:input.pressure??1,time:input.time??0};
    if(this.last&&!final){p.x=this.last.x*this.stabilization+p.x*(1-this.stabilization);p.y=this.last.y*this.stabilization+p.y*(1-this.stabilization);}
    if(!this.last){this.dab(p);this.last=p;this.remaining=0;return;}
    const from=this.last,dx=p.x-from.x,dy=p.y-from.y,distance=Math.hypot(dx,dy),spacing=Math.max(.35,this.size*.12*Math.max(.1,Math.min(from.pressure,p.pressure)));
    let pos=spacing-this.remaining;
    for(;pos<=distance;pos+=spacing){const t=pos/distance;this.dab({x:from.x+dx*t,y:from.y+dy*t,pressure:from.pressure+(p.pressure-from.pressure)*t,time:from.time+(p.time-from.time)*t});}
    this.remaining=(this.remaining+distance)%spacing;this.last=p;
  }
  cancel(){if(this.closed)return;for(const tile of this.tiles.values()){if(tile.before)this.store.set(tile.tx,tile.ty,tile.before);else this.store.delete(tile.tx,tile.ty);}this.closed=true;}
  finish(){if(this.closed)return[];this.closed=true;
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
  for(let p=0;p<count;p++){const i=p*4,a=origin[i+3]/255;eligible[p]=Math.max(Math.abs(origin[i]*a-origin[target]*ta),Math.abs(origin[i+1]*a-origin[target+1]*ta),Math.abs(origin[i+2]*a-origin[target+2]*ta),Math.abs(origin[i+3]-origin[target+3]))<=tolerance?1:0;}
  // Close gaps by dilating nonmatching boundaries, flood, then restore edges.
  function expand(input,steps){let current=input;for(let step=0;step<steps;step++){const next=current.slice();for(let p=0;p<count;p++)if(current[p]){if(p%width)next[p-1]=1;if(p%width<width-1)next[p+1]=1;if(p>=width)next[p-width]=1;if(p+width<count)next[p+width]=1;}current=next;}return current;}
  const blocked=gap?expand(eligible.map(n=>1-n),gap):null;
  let head=0,tail=0;const start=y*width+x;if(blocked?.[start])return;queue[tail++]=start;mask[start]=1;
  while(head<tail){const p=queue[head++],visit=n=>{if(!mask[n]&&eligible[n]&&!blocked?.[n]){mask[n]=1;queue[tail++]=n;}};if(p%width)visit(p-1);if(p%width<width-1)visit(p+1);if(p>=width)visit(p-width);if(p+width<count)visit(p+width);}
  const grown=expand(mask,gap+expansion),touched=new Set();
  for(let p=0;p<count;p++)if(grown[p]){pixels.set(color,p*4);touched.add(tileKey(Math.floor((bounds.x+p%width)/TILE),Math.floor((bounds.y+Math.floor(p/width))/TILE)));}
  for(const key of touched){const [tx,ty]=key.split(',').map(Number),tile=store.writable(tx,ty),ox=tx*TILE-bounds.x,oy=ty*TILE-bounds.y;
    for(let py=Math.max(0,-oy);py<Math.min(TILE,height-oy);py++)tile.pixels.set(pixels.subarray(((py+oy)*width+Math.max(0,ox))*4,((py+oy)*width+Math.min(width,ox+TILE))*4),(py*TILE+Math.max(0,-ox))*4);}
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
