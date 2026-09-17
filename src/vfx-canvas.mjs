import {activeVfx,vfxStack,vfxPadding} from './vfx.mjs';
import {filterVfxCanvas,vfxSurfaceDimension} from './vfx-gpu.mjs';
import {fitsVfxSurface,vfxSurfaceTiles,vfxSurfaceError} from './vfx-surface.mjs';
import {sceneVfxPlan,checkSceneVfxPlan} from './vfx-scene.mjs';
const surfaces=new WeakMap();
const sceneSurfaces=new WeakMap();
const sceneInputs=new WeakMap();
const empty=Object.freeze([]);
export function segmentVfx(item){if(!item.obj?._stykVfx||item.type==='poly'||!item.seg)return empty;return vfxStack(item.obj,{kind:'segment',figureTypeId:item.fig?.figure_type_id,handleId:item.seg.segment_id});}
export function drawableVfxPadding(item){
 if(!item.obj?._stykVfx&&!item._movieclipOwner&&!item._movieclipInner)return 0;
 let padding=vfxPadding(vfxStack(item.obj),Math.abs(item.obj?.scale??1))+vfxPadding(segmentVfx(item),Math.abs(item.obj?.scale??1));
 if(item._movieclipOwner)padding+=vfxPadding(item._movieclipOwner.effects,Math.abs(item._movieclipOwner.scale??1));
 for(let inner=item._movieclipInner;inner;inner=inner.inner)padding+=vfxPadding(inner.owner.effects,Math.abs(inner.owner.scale??1));return padding;
}
export function hasDrawableVfx(item){if(item.obj?._stykVfx&&Object.values(item.obj._stykVfx).some(stack=>activeVfx(stack).length))return true;if(activeVfx(item._movieclipOwner?.effects).length)return true;for(let inner=item._movieclipInner;inner;inner=inner.inner)if(activeVfx(inner.owner.effects).length)return true;return false;}
/** Preview raster budgets must include nested effect halos, not only artwork.
 * Called on cache misses; the document and requested export scale are untouched. */
export function vfxRasterScale(items,bounds,requested,limit){
 let padding=0,filtered=false;
 for(const item of items)if(hasDrawableVfx(item)){filtered=true;padding=Math.max(padding,drawableVfxPadding(item));}
 if(!filtered)return requested;
 const deviceLimit=limit??(typeof OffscreenCanvas==='undefined'?4096:vfxSurfaceDimension());
 const edge=Math.min(4096,deviceLimit)-128; // rounding/antialias guards through nested scopes
 return Math.min(requested,edge/(bounds.width+2*padding),edge/(bounds.height+2*padding));
}
export function withVfx(context,stack,paint,{bounds,domainBounds=bounds,scale=1}={}){
 stack=activeVfx(stack);if(!stack.length){paint(context);return;}
 const matrix=context.getTransform(),pixelScale=Math.hypot(matrix.a,matrix.b)*Math.abs(scale),pad=vfxPadding(stack,pixelScale)+2;
 const corners=bounds?[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f})): [{x:0,y:0},{x:context.canvas.width,y:context.canvas.height}];
 const x=Math.max(-pad,Math.floor(Math.min(...corners.map(p=>p.x)))-pad),y=Math.max(-pad,Math.floor(Math.min(...corners.map(p=>p.y)))-pad),right=Math.min(context.canvas.width+pad,Math.ceil(Math.max(...corners.map(p=>p.x)))+pad),bottom=Math.min(context.canvas.height+pad,Math.ceil(Math.max(...corners.map(p=>p.y)))+pad),width=Math.max(1,right-x),height=Math.max(1,bottom-y);
 if(right<=-pad||bottom<=-pad||x>=context.canvas.width+pad||y>=context.canvas.height+pad)return;
 // Anchor spatial filters to the full owner bounds, never the viewport/tile crop.
 const domain=domainBounds?[[domainBounds.x,domainBounds.y],[domainBounds.x+domainBounds.width,domainBounds.y],[domainBounds.x,domainBounds.y+domainBounds.height],[domainBounds.x+domainBounds.width,domainBounds.y+domainBounds.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f})):corners; const anchorX=Math.min(...domain.map(p=>p.x)),anchorY=Math.min(...domain.map(p=>p.y));
 const outputSize={width:Math.max(1,Math.max(...domain.map(p=>p.x))-anchorX),height:Math.max(1,Math.max(...domain.map(p=>p.y))-anchorY)};
 const render=tile=>{
  let surface=surfaces.get(context);if(!surface){surface=new OffscreenCanvas(tile.width,tile.height);surfaces.set(context,surface);}if(surface.width!==tile.width)surface.width=tile.width;if(surface.height!==tile.height)surface.height=tile.height;
  const ctx=surface.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,tile.width,tile.height);ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e-tile.x,matrix.f-tile.y);paint(ctx);
  const filtered=filterVfxCanvas(surface,stack,{scale:pixelScale,origin:{x:tile.x-anchorX,y:tile.y-anchorY},outputSize});
  context.save();try{context.setTransform(1,0,0,1,0,0);const out=tile.output;
   if(out)context.drawImage(filtered,out.x-tile.x,out.y-tile.y,out.width,out.height,out.x,out.y,out.width,out.height);
   else context.drawImage(filtered,tile.x,tile.y);
  }finally{context.restore();}
 };
 const rect={x,y,width,height},limit=vfxSurfaceDimension();
 if(fitsVfxSurface(width,height,limit))render(rect);
 else for(const tile of vfxSurfaceTiles(rect,context.canvas,pad,limit))render(tile);
}
export function applySceneVfx(context,frame,{scale=1,origin={x:0,y:0},outputSize,clip,padding}={}){
 const stack=activeVfx(vfxStack(frame));if(!stack.length)return false;
 const pad=padding??vfxPadding(stack,scale,Math.max(outputSize?.width??context.canvas.width,outputSize?.height??context.canvas.height)),width=context.canvas.width+2*pad,height=context.canvas.height+2*pad;
 if(!fitsVfxSurface(width,height,vfxSurfaceDimension()))throw vfxSurfaceError();
 let source=context.canvas;
 if(pad||clip){source=sceneSurfaces.get(context);if(!source){source=new OffscreenCanvas(width,height);sceneSurfaces.set(context,source);}if(source.width!==width)source.width=width;if(source.height!==height)source.height=height;const c=source.getContext('2d');c.clearRect(0,0,width,height);c.save();if(clip){c.beginPath();c.rect(clip.x+pad,clip.y+pad,clip.width,clip.height);c.clip();}c.drawImage(context.canvas,pad,pad);c.restore();}
 const output=filterVfxCanvas(source,stack,{scale,origin:{x:origin.x-pad,y:origin.y-pad},outputSize:outputSize??{width:context.canvas.width,height:context.canvas.height}});context.save();context.setTransform(1,0,0,1,0,0);if(clip){context.beginPath();context.rect(clip.x,clip.y,clip.width,clip.height);context.clip();}context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(output,-pad,-pad);context.restore();return true;
}
/** Render into real neighboring scene pixels before filtering. Unlike
 * applySceneVfx, this must be called before painting, not after camera clipping. */
export function prepareSceneVfx(context,frame,viewport,scale=1){
 const plan=sceneVfxPlan(frame,context.canvas.width,context.canvas.height,viewport,scale);
 const stack=activeVfx(vfxStack(frame));
 if(stack.length)checkSceneVfxPlan(plan,vfxSurfaceDimension());
 let target=context;
 if(plan.pad){
  let source=sceneInputs.get(context);
  if(!source){source=new OffscreenCanvas(1,1);sceneInputs.set(context,source);}
  if(source.width!==plan.width)source.width=plan.width;if(source.height!==plan.height)source.height=plan.height;
  target=source.getContext('2d');
 }
 return {...plan,context:target,finish(){
  if(!stack.length)return;
  const output=filterVfxCanvas(target.canvas,stack,{scale,origin:plan.viewport,outputSize:plan.outputSize});
  context.save();try{context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(output,-plan.pad,-plan.pad);}finally{context.restore();}
 }};
}
export function releaseVfxSurface(context){const input=sceneInputs.get(context);if(input){releaseVfxSurface(input.getContext('2d'));input.width=input.height=1;sceneInputs.delete(context);}const scene=sceneSurfaces.get(context);if(scene){scene.width=scene.height=1;sceneSurfaces.delete(context);}const surface=surfaces.get(context);if(surface){releaseVfxSurface(surface.getContext('2d'));surface.width=surface.height=1;surfaces.delete(context);}}
