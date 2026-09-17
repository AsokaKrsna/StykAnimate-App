import {activeVfx,vfxStack} from './vfx.mjs';
import {compileVectorObject,objectBounds} from './renderer-geometry.mjs';
import {supportsVectorIsolation,rasterizeVectorGroup} from './renderer-vector-raster.mjs';
import {vfxWebGPUFor} from './vfx-webgpu.mjs';

/** One opaque isolation group can stay on the same GPU through rasterization
 * and filtering. Nested effects and Canvas-only artwork retain their renderer. */
export function vectorVfxSource(items,resolution){
 const owner=items[0]?._movieclipOwner,object=items[0]?.obj,stack=activeVfx(owner?.effects??vfxStack(object));
 if(!stack.length||owner?.sceneEffects?.length||owner&&owner.opacity!==1)return null;
 const clean=[];
 for(const item of items){
  if(item._movieclipOwner!==owner||item._movieclipInner||item.opacity<.999999||!owner&&item.obj!==object)return null;
  if(Object.entries(item.obj?._stykVfx??{}).some(([key,effects])=>(owner||key!=='figure')&&activeVfx(effects).length))return null;
  clean.push({...item,_movieclipOwner:undefined,_movieclipInner:undefined,obj:{...item.obj,_stykVfx:undefined}});
 }
 return supportsVectorIsolation(clean,resolution)?{items:clean,stack,scale:Math.abs(owner?.scale??object?.scale??1),domain:owner?.domainBounds}:null;
}
export function rasterizeVectorVfx(renderer,source,{width,height,pixelScale,bounds,root}){
 const data=source.data??compileVectorObject(source.items,root,0),domain=source.domain??objectBounds(source.items,{...renderer.resources,vfxBounds:false});
 const raster=rasterizeVectorGroup(renderer,{data,width,height,pixelScale,bounds,root});let texture;
 try{
  const output=vfxWebGPUFor(renderer.device).run(raster,source.stack,{texture:true,scale:pixelScale*source.scale,origin:{x:(bounds.x-domain.x)*pixelScale,y:(bounds.y-domain.y)*pixelScale},outputSize:{width:domain.width*pixelScale,height:domain.height*pixelScale}});
  texture=renderer.device.createTexture({label:'Filtered vector artwork',size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const encoder=renderer.device.createCommandEncoder({label:'Retain filtered vector artwork'});encoder.copyTextureToTexture({texture:output.texture},{texture},[width,height]);renderer.device.queue.submit([encoder.finish()]);
  return {texture,bindGroup:renderer.textureBindGroup(texture),width,height,bytes:width*height*4};
 }catch(error){texture?.destroy();throw error;}finally{raster.texture.destroy();}
}
