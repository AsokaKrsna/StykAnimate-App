import {TILE,TILE_BYTES,TileStore,tileKey} from './drawing-tiles.mjs';
import {tileChanges} from './drawing-pixels.mjs';
import {paintDrawingTiles} from './drawing-raster.mjs';

export function selectionMatrix(s){const a=s.angle*Math.PI/180,c=Math.cos(a)*s.scale,n=Math.sin(a)*s.scale;return[c,n,-n,c,s.cx+s.dx-c*s.cx+n*s.cy,s.cy+s.dy-n*s.cx-c*s.cy];}
export function selectionBounds(mask,m){const ps=[[mask.x,mask.y],[mask.x+mask.width,mask.y],[mask.x,mask.y+mask.height],[mask.x+mask.width,mask.y+mask.height]].map(([x,y])=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]})),x=Math.floor(Math.min(...ps.map(p=>p.x))),y=Math.floor(Math.min(...ps.map(p=>p.y)));return{x,y,width:Math.ceil(Math.max(...ps.map(p=>p.x)))-x,height:Math.ceil(Math.max(...ps.map(p=>p.y)))-y};}
const inRect=(t,r)=>t.tx*TILE<r.x+r.width&&(t.tx+1)*TILE>r.x&&t.ty*TILE<r.y+r.height&&(t.ty+1)*TILE>r.y;
export function selectionTiles(store,mask,m){const destination=selectionBounds(mask,m);return [...store].filter(t=>inRect(t,mask)||inRect(t,destination));}
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});

/** Commit in the pixel worker. Preview canvases never become source pixels.
 * Unselected bytes are preserved exactly, including RGB at low/zero alpha. */
export function transformSelectedPixels(store,{mask,pixels,matrix,remove=false,maxBytes=192*1024*1024}){
  const before=new Map(),B=mask;
  if(!B||!Number.isInteger(B.width)||!Number.isInteger(B.height)||B.width<1||B.height<1||B.width*B.height>16*1024*1024||pixels.length!==B.width*B.height*4||B.mask.length!==B.width*B.height||matrix.length!==6||!matrix.every(Number.isFinite))throw new Error('Invalid pixel selection.');
  const edit=(tx,ty)=>{const key=tileKey(tx,ty);if(!before.has(key)){if((before.size+1)*TILE_BYTES*3>maxBytes)throw new Error('The selection exceeds the drawing working memory limit.');before.set(key,store.get(tx,ty)?.pixels.slice()??null);}return store.writable(tx,ty).pixels;};
  for(let y=0;y<B.height;y++)for(let x=0;x<B.width;x++)if(B.mask[y*B.width+x]){
    const px=B.x+x,py=B.y+y,tx=Math.floor(px/TILE),ty=Math.floor(py/TILE),tile=store.get(tx,ty),i=((py-ty*TILE)*TILE+px-tx*TILE)*4;
    if(tile?.pixels[i+3])edit(tx,ty)[i+3]=0;
  }
  if(remove)return tileChanges(store,before);
  const over=(x,y,rgba,i)=>{
    const alpha=rgba[i+3]/255;if(!alpha)return;
    const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE),p=edit(tx,ty),j=((y-ty*TILE)*TILE+x-tx*TILE)*4;
    if(alpha===1||!p[j+3]){p.set(rgba.subarray(i,i+4),j);return;}
    const base=p[j+3]/255,out=alpha+base*(1-alpha);for(let c=0;c<3;c++)p[j+c]=Math.round((rgba[i+c]*alpha+p[j+c]*base*(1-alpha))/out);p[j+3]=Math.round(out*255);
  };
  const [a,b,c,d,dx,dy]=matrix;
  if(a===1&&b===0&&c===0&&d===1&&Number.isInteger(dx)&&Number.isInteger(dy)){
    for(let y=0;y<B.height;y++)for(let x=0;x<B.width;x++){const i=y*B.width+x;if(B.mask[i])over(B.x+x+dx,B.y+y+dy,pixels,i*4);}
  }else{
    const rect=selectionBounds(B,matrix);
    if(rect.width*rect.height*4>maxBytes)throw new Error('The transformed selection exceeds the drawing working memory limit.');
    const cut=pixels.slice();for(let i=0;i<B.mask.length;i++)if(!B.mask[i])cut[i*4+3]=0;
    const source=canvas(B.width,B.height);source.getContext('2d').putImageData(new ImageData(cut,B.width,B.height),0,0);
    const output=canvas(TILE,TILE),ctx=output.getContext('2d',{willReadFrequently:true});
    for(const [tx,ty] of TileStore.tilesInRect(rect.x-1,rect.y-1,rect.width+2,rect.height+2)){
      ctx.resetTransform();ctx.clearRect(0,0,TILE,TILE);ctx.setTransform(a,b,c,d,dx-tx*TILE,dy-ty*TILE);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,B.x,B.y);
      const p=ctx.getImageData(0,0,TILE,TILE).data;for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++)over(tx*TILE+x,ty*TILE+y,p,(y*TILE+x)*4);
    }
    source.width=source.height=output.width=output.height=1;
  }
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
    if(p.key!==key||p.drawn!==p.stamp){
      p.canvas??=canvas(width,height);if(p.canvas.width!==width)p.canvas.width=width;if(p.canvas.height!==height)p.canvas.height=height;
      const ctx=p.canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,width,height);ctx.setTransform(1/f,0,0,1/f,-x,-y);paintDrawingTiles(ctx,base);
      ctx.globalCompositeOperation='destination-out';ctx.drawImage(s.maskCanvas,s.mask.x,s.mask.y);ctx.globalCompositeOperation='source-over';ctx.transform(...selectionMatrix(s));ctx.drawImage(s.cutout,s.mask.x,s.mask.y);
      p.key=key;p.drawn=p.stamp;
    }
    return{canvas:p.canvas,x,y,width,height,scale:f,level,stamp:p.stamp,anchorKey:key,dirty:null};
  };
  return p;
}
