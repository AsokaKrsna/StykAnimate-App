import {cameraMatrix} from './renderer-geometry.mjs';
import {drawBackground,backgroundBounds} from './pivot/background.mjs';

/** Re-render retained GPU artwork into camera coordinates. Share the device,
 * primitive buffers and textures; own only one camera surface and MSAA target. */
export class CameraGpuSource {
 constructor(renderer){this.renderer=renderer;this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('Camera VFX require an offscreen graphics context.');}
 paint(target,options,width,height){
  const r=this.renderer,{report,frame}=options,scale=width/report.canvas_width;
  const samples=r.msaaCount>1?r.msaaCount:0;
  if(this.width!==width||this.height!==height||this.msaaSamples!==samples){
   this.width=width;this.height=height;this.canvas.width=width;this.canvas.height=height;
   this.context.configure({device:r.device,format:r.format,alphaMode:'premultiplied'});
   this.msaa?.destroy();this.msaaSamples=samples;
   this.msaa=samples?r.device.createTexture({label:'VFX camera MSAA',size:[width,height],sampleCount:samples,format:r.format,usage:GPUTextureUsage.RENDER_ATTACHMENT}):null;
  }
  const matrix=cameraMatrix({report,frame,view:{scale},cameraEnabled:true});
  const uniform=new Float32Array([matrix[0],matrix[2],matrix[4],Math.hypot(matrix[0],matrix[1]),matrix[1],matrix[3],matrix[5],0,width,height,1,1,0,0,width,height]);
  r.device.queue.writeBuffer(r.uniform,0,uniform);
  const encoder=r.device.createCommandEncoder({label:'VFX camera artwork'}),pass=encoder.beginRenderPass({colorAttachments:[this.msaa
   ?{view:this.msaa.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'discard'}
   :{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
  const prepared=options.preparedFrame;
  pass.setPipeline(r.pipeline);pass.setBindGroup(0,prepared?.bindGroup??r.globalBindGroup);
  if(prepared){
   for(const command of prepared.commands){const first=Math.max(command.firstInstance,prepared.backgroundCount),count=command.firstInstance+command.instanceCount-first;if(count<=0)continue;pass.setBindGroup(1,command.texture?.bindGroup||r.blankBindGroup);pass.draw(6,count,0,first);}
  }else{
  let begin=-1,count=0;
  const flush=()=>{if(count){pass.setBindGroup(1,r.blankBindGroup);pass.draw(6,count,0,begin);count=0;begin=-1;}};
  for(const entry of r.layout){
   if(!entry.g||entry.isOnion){flush();continue;}
   if(entry.texture){flush();pass.setBindGroup(1,entry.texture.bindGroup);pass.draw(6,entry.count,0,entry.offset);}
   else {if(count&&begin+count!==entry.offset)flush();if(begin<0)begin=entry.offset;count+=entry.capacity;}
  }
  flush();}
  pass.end();r.device.queue.submit([encoder.finish()]);
  // Queue order makes the camera submission see its own uniforms, then restores
  // the editor state before subsequent work on the shared device.
  if(options.viewportUniforms)r.device.queue.writeBuffer(r.uniform,0,options.viewportUniforms);
  target.setTransform(1,0,0,1,0,0);target.clearRect(0,0,width,height);target.save();
  target.transform(...matrix);drawBackground(target,report,frame,report.canvas_width,report.canvas_height,{...r.resources,bounds:backgroundBounds(frame,report.canvas_width,report.canvas_height,true,report)});target.restore();
  target.drawImage(this.canvas,0,0);
 }
 destroy(){this.msaa?.destroy();this.context.unconfigure();this.canvas.width=this.canvas.height=1;}
}
