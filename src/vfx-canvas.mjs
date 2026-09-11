import {activeVfx,vfxStack,vfxPadding} from './vfx.mjs';
import {filterVfxCanvas} from './vfx-gpu.mjs';
const surfaces=new WeakMap();
const sceneSurfaces=new WeakMap();
const empty=Object.freeze([]);
export function segmentVfx(item){if(!item.obj?._stykVfx||item.type==='poly'||!item.seg)return empty;return vfxStack(item.obj,{kind:'segment',figureTypeId:item.fig?.figure_type_id,handleId:item.seg.segment_id});}
export function drawableVfxPadding(item){
 if(!item.obj?._stykVfx&&!item._movieclipOwner&&!item._movieclipInner)return 0;
 let padding=vfxPadding(vfxStack(item.obj),Math.abs(item.obj?.scale??1))+vfxPadding(segmentVfx(item),Math.abs(item.obj?.scale??1));
 if(item._movieclipOwner)padding+=vfxPadding(item._movieclipOwner.effects,Math.abs(item._movieclipOwner.scale??1));
 for(let inner=item._movieclipInner;inner;inner=inner.inner)padding+=vfxPadding(inner.owner.effects,Math.abs(inner.owner.scale??1));return padding;
}
export function hasDrawableVfx(item){if(item.obj?._stykVfx&&Object.values(item.obj._stykVfx).some(stack=>activeVfx(stack).length))return true;if(activeVfx(item._movieclipOwner?.effects).length)return true;for(let inner=item._movieclipInner;inner;inner=inner.inner)if(activeVfx(inner.owner.effects).length)return true;return false;}
export function withVfx(context,stack,paint,{bounds,domainBounds=bounds,scale=1}={}){
 stack=activeVfx(stack);if(!stack.length){paint(context);return;}
 const matrix=context.getTransform(),pixelScale=Math.hypot(matrix.a,matrix.b)*Math.abs(scale),pad=vfxPadding(stack,pixelScale)+2;
 const corners=bounds?[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f})): [{x:0,y:0},{x:context.canvas.width,y:context.canvas.height}];
 const x=Math.max(-pad,Math.floor(Math.min(...corners.map(p=>p.x)))-pad),y=Math.max(-pad,Math.floor(Math.min(...corners.map(p=>p.y)))-pad),right=Math.min(context.canvas.width+pad,Math.ceil(Math.max(...corners.map(p=>p.x)))+pad),bottom=Math.min(context.canvas.height+pad,Math.ceil(Math.max(...corners.map(p=>p.y)))+pad),width=Math.max(1,right-x),height=Math.max(1,bottom-y);
 if(right<=-pad||bottom<=-pad||x>=context.canvas.width+pad||y>=context.canvas.height+pad)return;
 if(width*height>16777216)throw new Error('The VFX drawing region exceeds the graphics budget. Reduce the effect radius or output tile size.');
 let surface=surfaces.get(context);if(!surface){surface=new OffscreenCanvas(width,height);surfaces.set(context,surface);}if(surface.width!==width)surface.width=width;if(surface.height!==height)surface.height=height;
 const ctx=surface.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e-x,matrix.f-y);paint(ctx);
 // Anchor spatial filters to the full owner bounds, never the viewport/tile crop.
 const domain=domainBounds?[[domainBounds.x,domainBounds.y],[domainBounds.x+domainBounds.width,domainBounds.y],[domainBounds.x,domainBounds.y+domainBounds.height],[domainBounds.x+domainBounds.width,domainBounds.y+domainBounds.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f})):corners; const anchorX=Math.min(...domain.map(p=>p.x)),anchorY=Math.min(...domain.map(p=>p.y));
 const filtered=filterVfxCanvas(surface,stack,{scale:pixelScale,origin:{x:x-anchorX,y:y-anchorY},outputSize:{width:Math.max(1,Math.max(...domain.map(p=>p.x))-anchorX),height:Math.max(1,Math.max(...domain.map(p=>p.y))-anchorY)}});context.save();context.setTransform(1,0,0,1,0,0);context.drawImage(filtered,x,y);context.restore();
}
export function applySceneVfx(context,frame,{scale=1,origin={x:0,y:0},outputSize,clip}={}){
 const stack=activeVfx(vfxStack(frame));if(!stack.length)return false;
 const pad=vfxPadding(stack,scale,Math.max(outputSize?.width??context.canvas.width,outputSize?.height??context.canvas.height)),width=context.canvas.width+2*pad,height=context.canvas.height+2*pad;
 if(width*height>16777216)throw new Error('The scene effect surface exceeds the graphics budget. Use smaller export tiles or reduce the effect radius.');
 let source=context.canvas;
 if(pad||clip){source=sceneSurfaces.get(context);if(!source){source=new OffscreenCanvas(width,height);sceneSurfaces.set(context,source);}if(source.width!==width)source.width=width;if(source.height!==height)source.height=height;const c=source.getContext('2d');c.clearRect(0,0,width,height);c.save();if(clip){c.beginPath();c.rect(clip.x+pad,clip.y+pad,clip.width,clip.height);c.clip();}c.drawImage(context.canvas,pad,pad);c.restore();}
 const output=filterVfxCanvas(source,stack,{scale,origin:{x:origin.x-pad,y:origin.y-pad},outputSize:outputSize??{width:context.canvas.width,height:context.canvas.height}});context.save();context.setTransform(1,0,0,1,0,0);if(clip){context.beginPath();context.rect(clip.x,clip.y,clip.width,clip.height);context.clip();}context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(output,-pad,-pad);context.restore();return true;
}
export function releaseVfxSurface(context){const scene=sceneSurfaces.get(context);if(scene){scene.width=scene.height=1;sceneSurfaces.delete(context);}const surface=surfaces.get(context);if(surface){releaseVfxSurface(surface.getContext('2d'));surface.width=surface.height=1;surfaces.delete(context);}}
