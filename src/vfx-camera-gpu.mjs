import {messageError} from './localized-error.mjs';
import {parallaxResolver} from './layer-parallax.mjs';
import {cameraMatrix,shapeRecord,SHAPE} from './renderer-geometry.mjs';
import {opacityArtwork} from './renderer-opacity.mjs';
import {drawBackground,backgroundBounds} from './pivot/background.mjs';
import {sceneVfxBounds} from './vfx-scene.mjs';
import {encodePreparedCommands} from './prepared-frames.mjs';
import {offsetGeneratorBatch,generatorSchedule,scheduleWalker} from './vfx-generator-frame.mjs';

/** Re-render retained GPU artwork into camera coordinates. Share the device,
 * primitive buffers and textures; own only one camera surface and MSAA target. */
export class CameraGpuSource {
 constructor(renderer){this.renderer=renderer;this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('webgpu');if(!this.context)throw messageError(new Error(''), "errors.vfxCameraGpu.cameraVfxRequireAnOffscreenGraphicsContext", {});}
 paint(target,options,width,height,plan){
  const r=this.renderer,{report,frame}=options,scale=plan.outputSize.width/report.canvas_width;
  const samples=r.msaaCount>1?r.msaaCount:0;
  if(this.width!==width||this.height!==height||this.msaaSamples!==samples){
   this.width=width;this.height=height;this.canvas.width=width;this.canvas.height=height;
   this.context.configure({device:r.device,format:r.format,alphaMode:'premultiplied'});
   this.msaa?.destroy();this.msaaSamples=samples;
   this.msaa=samples?r.device.createTexture({label:'VFX camera MSAA',size:[width,height],sampleCount:samples,format:r.format,usage:GPUTextureUsage.RENDER_ATTACHMENT}):null;
  }
  const matrix=cameraMatrix({report,frame,view:{scale,x:-plan.viewport.x,y:-plan.viewport.y},cameraEnabled:true});
  const uniform=new Float32Array([matrix[0],matrix[2],matrix[4],Math.hypot(matrix[0],matrix[1]),matrix[1],matrix[3],matrix[5],0,width,height,1,1,0,0,width,height]);
  const restored=[],lease=r.rasterCache.lease();
  try{
  r.device.queue.writeBuffer(r.uniform,0,uniform);
  if(!options.preparedFrame&&options.cameraEnabled===false){
    if(this.depthTransforms?.length!==r.transformData.length)this.depthTransforms=new Float32Array(r.transformData.length);
    this.depthTransforms.set(r.transformData);const depth=parallaxResolver(report,frame);
    for(const entry of r.layout){if(!entry.g||entry.isOnion)continue;const d=depth(entry.uid),i=entry.transform*4;this.depthTransforms[i]+=d.x;this.depthTransforms[i+1]+=d.y;}
    r.device.queue.writeBuffer(r.transformBuffer,0,this.depthTransforms);
  }
  const encoder=r.device.createCommandEncoder({label:'VFX camera artwork'}),drawingGpu=r.drawingGpu,drawings=new Map(),cameraEntries=new Map();
  if(!options.preparedFrame)for(const entry of r.layout){
   if(entry.isOnion||options.hiddenUids?.has(entry.uid)||!entry.drawing||entry.gpuDrawing)continue;
   // The editor scratch covers its viewport, which can omit artwork sampled
   // by the camera after a drag, rotation or parallax shift. Reuse the bounded
   // artwork owner for an independently sampled camera source.
   const {source,items}=opacityArtwork(entry.g,entry.drawingItems);
   // A live stroke may widen tile coverage without replacing its geometry.
   r.boundsCache?.delete(source);
   const texture=r.rasterObject(source,items,Math.hypot(matrix[0],matrix[1]));
   if(!texture)continue;lease.add(texture);
   const b=texture.bounds,origin=texture.origin,data=new Float32Array(shapeRecord({
    a:[b.x-origin.x,b.y-origin.y,b.x+b.width-origin.x,b.y+b.height-origin.y],gradient:texture.region,
    color:[1,1,1,1],mode:SHAPE.TEXTURE,transform:entry.transform}));
   const cameraEntry={...entry,data,texture,count:1};cameraEntries.set(entry,cameraEntry);restored.push(entry);r.uploadEntry(cameraEntry);
  }
  if(!options.preparedFrame&&drawingGpu&&!drawingGpu.destroyed){
   const transforms=options.cameraEnabled===false?this.depthTransforms:r.transformData;
   for(const entry of r.layout)if(entry.gpuDrawing&&!entry.isOnion&&!options.hiddenUids?.has(entry.uid)){
    const at=entry.transform*4,translation={x:transforms[at]-entry.source.root.x,y:transforms[at+1]-entry.source.root.y};
    drawings.set(entry,drawingGpu.prepare(entry.drawing,r.gpuDrawingView(entry,matrix,{width,height,dpr:1,translation})));
   }
   drawingGpu.encode(encoder);
  }
  const pass=encoder.beginRenderPass({colorAttachments:[this.msaa
   ?{view:this.msaa.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'discard'}
   :{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
  const prepared=options.preparedFrame;
  pass.setPipeline(r.pipeline);pass.setBindGroup(0,prepared?.bindGroup??r.globalBindGroup);
  if(prepared){
   encodePreparedCommands(r,pass,prepared,{hiddenUids:options.hiddenUids,dragTranslations:options.dragTranslations,skipBackground:true});
  }else{
  let begin=-1,count=0;
  const flush=()=>{if(count){pass.setBindGroup(1,r.blankBindGroup);pass.draw(6,count,0,begin);count=0;begin=-1;}};
  // Generated effects: the editor pass's batch, plus camera parallax in world view.
  const depth=options.cameraEnabled===false?parallaxResolver(report,frame):null,batch=depth?offsetGeneratorBatch(r.lastGeneratorBatch,depth):r.lastGeneratorBatch;
  const plan=batch&&generatorSchedule(batch,options.hiddenUids),gpu=plan&&!plan.empty?r.generatorGpu():null;
  if(gpu)gpu.upload(batch);
  const walker=gpu?scheduleWalker(plan,draws=>{flush();gpu.draw(pass,draws,r.msaaCount,p=>{p.setPipeline(r.pipeline);p.setBindGroup(0,r.globalBindGroup);});}):null;
  walker?.begin();
  for(const original of r.layout){
   const entry=cameraEntries.get(original)??original;
   if(!entry.g||entry.isOnion){flush();continue;}
   walker?.object(entry.uid);
   const drawing=drawings.get(entry);
   if(drawing){flush();drawingGpu.draw(pass,drawing);pass.setPipeline(r.pipeline);pass.setBindGroup(0,r.globalBindGroup);}
   else if(entry.texture){flush();pass.setBindGroup(1,entry.texture.bindGroup);pass.draw(6,entry.count,0,entry.offset);}
   else {if(count&&begin+count!==entry.offset)flush();if(begin<0)begin=entry.offset;count+=entry.capacity;}
  }
  flush();walker?.end();}
  pass.end();r.device.queue.submit([encoder.finish()]);
  }finally{
  // Queue order makes the camera submission see its own uniforms, then restores
  // the editor state before subsequent work on the shared device.
  try{
   for(const entry of restored)r.uploadEntry(entry);
   if(!options.preparedFrame&&options.cameraEnabled===false)r.device.queue.writeBuffer(r.transformBuffer,0,r.transformData);
   if(options.viewportUniforms)r.device.queue.writeBuffer(r.uniform,0,options.viewportUniforms);
  }finally{lease.release();if(!r.destroyed)r.artworkStats();}
  }
  target.setTransform(1,0,0,1,0,0);target.clearRect(0,0,width,height);target.save();
  target.transform(...matrix);drawBackground(target,report,frame,report.canvas_width,report.canvas_height,{...r.resources,bounds:backgroundBounds(frame,report.canvas_width,report.canvas_height,true,report,sceneVfxBounds(report,plan)),paintBounds:backgroundBounds(frame,report.canvas_width,report.canvas_height,true,report)});target.restore();
  target.drawImage(this.canvas,0,0);
 }
 destroy(){this.msaa?.destroy();this.context.unconfigure();this.canvas.width=this.canvas.height=1;}
}
