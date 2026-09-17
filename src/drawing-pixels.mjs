import {DRAWING_TILE,DRAWING_MAX_PIXELS} from './drawing-model.mjs';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function assertPixels(pixels,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>DRAWING_MAX_PIXELS||
    !(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw new Error('Invalid drawing pixel surface.');
}
export function tileRect(x,y,width,height) {return {x,y,width:Math.min(DRAWING_TILE,width-x),height:Math.min(DRAWING_TILE,height-y)};}
export function readTile(pixels,width,rect) {
  const bytes=new Uint8ClampedArray(rect.width*rect.height*4);
  for(let y=0;y<rect.height;y++)bytes.set(pixels.subarray(((rect.y+y)*width+rect.x)*4,((rect.y+y)*width+rect.x+rect.width)*4),y*rect.width*4);
  return bytes;
}
export function compactTile(bytes){
  for(let i=4;i<bytes.length;i++)if(bytes[i]!==bytes[i%4])return bytes;
  return bytes.slice(0,4);
}
export function writeTile(pixels,width,tile,bytes) {
  if(bytes.length===4){const rgba=new Uint32Array(bytes.slice(0,4).buffer)[0],words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length/4);for(let y=0;y<tile.height;y++){const offset=(tile.y+y)*width+tile.x;words.fill(rgba,offset,offset+tile.width);}return;}
  for(let y=0;y<tile.height;y++)pixels.set(bytes.subarray(y*tile.width*4,(y+1)*tile.width*4),((tile.y+y)*width+tile.x)*4);
}
export function pixelChanges(before,after,width,height,maxBytes) {
  const changes=[];let bytes=0;
  for(let y=0;y<height;y+=DRAWING_TILE)for(let x=0;x<width;x+=DRAWING_TILE){
    const rect=tileRect(x,y,width,height);let a=readTile(before,width,rect),b=readTile(after,width,rect);
    if(!a.some((value,i)=>value!==b[i]))continue;
    a=compactTile(a);b=compactTile(b);bytes+=a.byteLength+b.byteLength+64;if(bytes>maxBytes)throw new Error('This pixel edit exceeds the undo budget. Select a smaller area or use 1× resolution.');
    changes.push({...rect,before:a,after:b});
  }
  return changes;
}
export const pixelChangeBytes=tiles=>tiles.reduce((n,t)=>n+t.before.byteLength+t.after.byteLength+64,256);

/** Exact CPU raster with tile-local stroke coverage. Opacity caps an entire
 * stroke; flow accumulates independent dabs without multiplying that cap. */
export class DrawingStroke {
  constructor(pixels,width,height,{size=8,color=[0,0,0],opacity=1,flow=1,hardness=1,erase=false,pressureSize=true,pressureOpacity=false,sizeCurve=1,opacityCurve=1,stabilization=0,maxBytes=48*1024*1024}={}) {
    assertPixels(pixels,width,height);
    if(![size,opacity,flow,hardness,sizeCurve,opacityCurve,stabilization].every(Number.isFinite)||!Array.isArray(color)||color.length!==3||!color.every(Number.isFinite))throw new Error('Invalid brush settings.');
    Object.assign(this,{pixels,width,height,size:clamp(size,.5,8192),color:color.map(n=>clamp(n,0,255)),opacity:clamp(opacity),flow:clamp(flow),hardness:clamp(hardness),erase,pressureSize,pressureOpacity,sizeCurve:clamp(sizeCurve,.1,4),opacityCurve:clamp(opacityCurve,.1,4),stabilization:clamp(stabilization,0,.95),maxBytes,tiles:new Map(),bytes:256,dirty:null});
  }
  tile(x,y) {
    const tx=Math.floor(x/DRAWING_TILE)*DRAWING_TILE,ty=Math.floor(y/DRAWING_TILE)*DRAWING_TILE,key=`${tx},${ty}`;
    let tile=this.tiles.get(key);if(tile)return tile;
    const rect=tileRect(tx,ty,this.width,this.height),cost=rect.width*rect.height*8+64;
    if(this.bytes+cost>this.maxBytes)throw new Error('This stroke exceeds the undo budget. Use shorter strokes or a smaller brush.');
    this.bytes+=cost;tile={...rect,before:readTile(this.pixels,this.width,rect),coverage:new Float32Array(rect.width*rect.height)};this.tiles.set(key,tile);return tile;
  }
  dab(p) {
    const pressure=clamp(p.pressure??1),radius=this.size*(this.pressureSize?Math.max(.05,pressure**this.sizeCurve):1)/2;
    const left=Math.max(0,Math.floor(p.x-radius)),top=Math.max(0,Math.floor(p.y-radius)),right=Math.min(this.width,Math.ceil(p.x+radius)),bottom=Math.min(this.height,Math.ceil(p.y+radius));
    const opacity=this.opacity*(this.pressureOpacity?pressure**this.opacityCurve:1);
    // Visit tiles once per dab, not once per pixel. Pressure may add paint,
    // but releasing pressure must never lift paint already laid in this stroke.
    for(let ty=Math.floor(top/DRAWING_TILE)*DRAWING_TILE;ty<bottom;ty+=DRAWING_TILE)for(let tx=Math.floor(left/DRAWING_TILE)*DRAWING_TILE;tx<right;tx+=DRAWING_TILE){
      let tile;
      for(let y=Math.max(top,ty);y<Math.min(bottom,ty+DRAWING_TILE);y++)for(let x=Math.max(left,tx);x<Math.min(right,tx+DRAWING_TILE);x++){
        const dx=x+.5-p.x,dy=y+.5-p.y,distance2=dx*dx+dy*dy;if(distance2>=radius*radius)continue;
        const edge=this.hardness>=.999?(distance2<=(radius-1)*(radius-1)&&radius>=1?1:clamp(radius-Math.sqrt(distance2))):clamp((1-Math.sqrt(distance2)/radius)/(1-this.hardness));
        tile??=this.tile(x,y);const q=(y-tile.y)*tile.width+x-tile.x,j=q*4,i=(y*this.width+x)*4;
        const previous=tile.coverage[q];tile.coverage[q]=Math.max(previous,previous+(opacity-previous)*edge*this.flow);
        const contribution=tile.coverage[q],alpha=tile.before[j+3]/255;
        if(this.erase){this.pixels[i+3]=Math.round(alpha*(1-contribution)*255);for(let c=0;c<3;c++)this.pixels[i+c]=tile.before[j+c];}
        else{const out=contribution+alpha*(1-contribution);this.pixels[i+3]=Math.round(out*255);for(let c=0;c<3;c++)this.pixels[i+c]=out?Math.round((this.color[c]*contribution+tile.before[j+c]*alpha*(1-contribution))/out):0;}
      }
    }
    if(right>left&&bottom>top)this.dirty=this.dirty?{x:Math.min(this.dirty.x,left),y:Math.min(this.dirty.y,top),right:Math.max(this.dirty.right,right),bottom:Math.max(this.dirty.bottom,bottom)}:{x:left,y:top,right,bottom};
  }
  sample(input,{final=false}={}) {
    if(this.closed)throw new Error('The stroke has already ended.');
    if(![input.x,input.y,input.pressure??1,input.time??0].every(Number.isFinite))return;
    const p={...input,x:clamp(input.x,-this.size,this.width+this.size),y:clamp(input.y,-this.size,this.height+this.size),pressure:input.pressure??1,time:input.time??0};
    if(this.last&&!final){p.x=this.last.x*this.stabilization+p.x*(1-this.stabilization);p.y=this.last.y*this.stabilization+p.y*(1-this.stabilization);}
    if(!this.last){this.dab(p);this.last=p;this.remaining=0;return;}
    const from=this.last,dx=p.x-from.x,dy=p.y-from.y,distance=Math.hypot(dx,dy),spacing=Math.max(.35,this.size*.12*Math.max(.1,Math.min(from.pressure,p.pressure)));
    let pos=spacing-this.remaining;
    for(;pos<=distance;pos+=spacing){const t=pos/distance;this.dab({x:from.x+dx*t,y:from.y+dy*t,pressure:from.pressure+(p.pressure-from.pressure)*t,time:from.time+(p.time-from.time)*t});}
    this.remaining=(this.remaining+distance)%spacing;this.last=p;
  }
  cancel(){if(this.closed)return;for(const tile of this.tiles.values())writeTile(this.pixels,this.width,tile,tile.before);this.closed=true;}
  finish(){if(this.closed)return [];this.closed=true;return [...this.tiles.values()].map(({coverage,...tile})=>({...tile,after:readTile(this.pixels,this.width,tile)})).filter(t=>t.before.some((n,i)=>n!==t.after[i])).map(t=>({...t,before:compactTile(t.before),after:compactTile(t.after)}));}
}

/** Flood a revision snapshot. Transparency ignores RGB of fully transparent
 * pixels. Tolerance compares premultiplied RGBA to avoid invisible RGB halos. */
export function floodPixels(pixels,width,height,{x,y,color=[0,0,0,255],tolerance=16,expansion=0,gap=0,source=pixels}={}) {
  assertPixels(pixels,width,height);assertPixels(source,width,height);
  x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=width||y>=height)return pixels;
  if(![tolerance,expansion,gap].every(Number.isFinite)||color.length!==4||!color.every(Number.isFinite))throw new Error('Invalid fill options.');
  tolerance=clamp(tolerance,0,255);expansion=Math.round(clamp(expansion,0,16));gap=Math.round(clamp(gap,0,8));
  const count=width*height,eligible=new Uint8Array(count),mask=new Uint8Array(count),queue=new Uint32Array(count),target=(y*width+x)*4,ta=source[target+3]/255;
  for(let p=0;p<count;p++){const i=p*4,a=source[i+3]/255;eligible[p]=Math.max(Math.abs(source[i]*a-source[target]*ta),Math.abs(source[i+1]*a-source[target+1]*ta),Math.abs(source[i+2]*a-source[target+2]*ta),Math.abs(source[i+3]-source[target+3]))<=tolerance?1:0;}
  // Close gaps by dilating nonmatching boundaries, flood, then restore edges.
  function expand(input,steps){let current=input;for(let step=0;step<steps;step++){const next=current.slice();for(let p=0;p<count;p++)if(current[p]){if(p%width)next[p-1]=1;if(p%width<width-1)next[p+1]=1;if(p>=width)next[p-width]=1;if(p+width<count)next[p+width]=1;}current=next;}return current;}
  const blocked=gap?expand(eligible.map(n=>1-n),gap):null;
  let head=0,tail=0;const start=y*width+x;if(blocked?.[start])return pixels;queue[tail++]=start;mask[start]=1;
  while(head<tail){const p=queue[head++],visit=n=>{if(!mask[n]&&eligible[n]&&!blocked?.[n]){mask[n]=1;queue[tail++]=n;}};if(p%width)visit(p-1);if(p%width<width-1)visit(p+1);if(p>=width)visit(p-width);if(p+width<count)visit(p+width);}
  const grown=expand(mask,gap+expansion);
  for(let p=0;p<count;p++)if(grown[p])pixels.set(color,p*4);return pixels;
}

export function lassoMask(width,height,points) {
  const mask=new Uint8Array(width*height);if(points.length<3)return mask;
  const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),maxY=Math.min(height,Math.ceil(Math.max(...points.map(p=>p.y))));
  for(let y=minY;y<maxY;y++){const crosses=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y+.5)!==(b.y>y+.5))crosses.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}crosses.sort((a,b)=>a-b);for(let i=0;i+1<crosses.length;i+=2)for(let x=Math.max(0,Math.ceil(crosses[i]-.5));x<Math.min(width,Math.ceil(crosses[i+1]-.5));x++)mask[y*width+x]=1;}
  return mask;
}
