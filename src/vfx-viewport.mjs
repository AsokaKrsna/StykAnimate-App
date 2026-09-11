import {activeVfx,vfxStack} from './vfx.mjs';
import {vfxGPUStats} from './vfx-gpu.mjs';
import {releaseVfxSurface} from './vfx-canvas.mjs';
import {CameraVfx} from './vfx-camera.mjs';
import {CameraGpuSource} from './vfx-camera-gpu.mjs';
const shader=`@group(0) @binding(0) var source:texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(p*2.-1.,0.,1.);}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {return textureLoad(source,vec2i(p.xy),0);}`;
export const hasSceneVfx=frame=>Boolean(activeVfx(vfxStack(frame)).length);
/** Bridge the completed GPU artwork through the same filter executor used by
 * workers/export, then draw editing handles after processing. No pixel readback. */
export class ViewportVfx{
 constructor(renderer){this.renderer=renderer;this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('2d');const d=renderer.device,module=d.createShaderModule({code:shader,label:'VFX final composition'});this.pipeline=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:renderer.format}]},multisample:{count:4}});}
 render(options){const r=this.renderer,w=r.canvas.width,h=r.canvas.height;if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  const c=this.context;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.drawImage(r.canvas,0,0);
  if(!this.camera){this.cameraSource=new CameraGpuSource(r);this.camera=new CameraVfx({paint:(...args)=>this.cameraSource.paint(...args)});}
  this.camera.render(c,{...options,resourceRevision:r.generation},r.dpr,r.resources);
  if(this.width!==w||this.height!==h){this.texture?.destroy();this.width=w;this.height=h;this.texture=r.device.createTexture({label:'VFX processed viewport',size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});this.bindGroup=r.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()}]});}
  r.device.queue.copyExternalImageToTexture({source:this.canvas},{texture:this.texture,premultipliedAlpha:true},[w,h]);
  const encoder=r.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:r.msaa.createView(),resolveTarget:r.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'discard'}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(3);
  if(!options.preparedFrame){pass.setPipeline(r.pipeline);pass.setBindGroup(0,r.globalBindGroup);for(const entry of r.layout){if(!entry.isOnion)continue;pass.setBindGroup(1,entry.texture?.bindGroup||r.blankBindGroup);pass.draw(6,entry.count,0,entry.offset);}}
  if(options.canvasHandles)r.handleRenderer.draw(pass);pass.end();r.device.queue.submit([encoder.finish()]);
  r.stats.vfx={...vfxGPUStats(),viewportBytes:w*h*8,cameraBytes:this.camera?this.camera.canvas.width*this.camera.canvas.height*24:0};
 }
 destroy(){this.texture?.destroy();this.camera?.destroy();this.cameraSource?.destroy();releaseVfxSurface(this.context);this.canvas.width=this.canvas.height=1;}
}
