import {drawExportScene} from './export-frame-core.mjs';
import {effectiveCamera} from './pivot/background.mjs';
import {layerVisible} from './layers.mjs';
import {releaseGeometryResources} from './pivot/geometry.mjs';
import {applySceneVfx} from './vfx-canvas.mjs';
import {activeVfx,vfxStack,vfxPadding} from './vfx.mjs';
import {fitsVfxSurface,vfxSurfaceError} from './vfx-surface.mjs';
import {vfxSurfaceDimension} from './vfx-gpu.mjs';
import {sceneVfxPlan,checkSceneVfxPlan} from './vfx-scene.mjs';

/** Process the camera and its sampling neighborhood before projecting the
 * cropped result into the viewport. Panning never changes effect coordinates. */
export class CameraVfx {
 constructor({paint}={}){this.paint=paint;this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('2d');}
 #prepare(options,dpr,resources){
  if(!this.context||this.context.isContextLost?.())throw Object.assign(new Error('The camera effects canvas is unavailable.'),{telemetryCode:'device_lost',telemetryStage:'prepare'});
  const {report,frame,view={},geometry,preparedFrame,hiddenUids,dragTranslations}=options;
  const camera=effectiveCamera(report,frame)??{},scale=camera.scale??1,angle=camera.angle_rad??0,cx=report.canvas_width/2,cy=report.canvas_height/2;
  // The software path re-rasterizes the camera image on every change; halve
  // its cap while the scene is live so drags and playback stay responsive.
  const padding=vfxPadding(vfxStack(frame),1,Math.max(report.canvas_width,report.canvas_height));
  const effectEdge=vfxSurfaceDimension()-128;
  const world=options.cameraEnabled===false,zoom=(view.scale??1)*dpr,requested=Math.max(.01,zoom*(world?scale:1)),
    cap=this.paint||!(options.liveEditing||options.playing)?2048:1024,
    resolution=Math.min(requested,cap/Math.max(report.canvas_width,report.canvas_height),effectEdge/(report.canvas_width+2*padding),effectEdge/(report.canvas_height+2*padding));
  const width=Math.max(1,Math.ceil(report.canvas_width*resolution)),height=Math.max(1,Math.ceil(report.canvas_height*resolution));
  const hidden=preparedFrame?preparedFrame.uids.filter(uid=>hiddenUids?.has(uid)):geometry?.orderedObjects?.filter(g=>hiddenUids?.has(g.obj.unique_id)).map(g=>g.obj.unique_id)??[];
  const plan=this.paint?checkSceneVfxPlan(sceneVfxPlan(frame,width,height,undefined,width/report.canvas_width),vfxSurfaceDimension()):null;
  const signature=JSON.stringify([options.resourceRevision,report._styk?.layers?.order.map(id=>report._styk.layers.byId[id].parallax),camera,width,height,plan?.pad,frame.background_id,frame.background_id_b,frame.background_mix,frame._stykBackgroundColor,hidden,dragTranslations instanceof Map?[...dragTranslations]:dragTranslations]);
  const stale=this.geometry!==geometry||this.preparedFrame!==preparedFrame||this.frame!==frame||this.signature!==signature||this.resources!==resources;
  if(stale){
   const sourceWidth=plan?.width??width,sourceHeight=plan?.height??height;
   if(this.canvas.width!==sourceWidth)this.canvas.width=sourceWidth;if(this.canvas.height!==sourceHeight)this.canvas.height=sourceHeight;
   if(this.paint)this.paint(this.context,options,sourceWidth,sourceHeight,plan);
   else {const drawables=geometry.drawables.filter(item=>!hiddenUids?.has(item.obj.unique_id)&&layerVisible(report,item.obj.unique_id)).map(item=>{
    const delta=dragTranslations?.get?.(item.obj.unique_id)||dragTranslations?.[item.obj.unique_id];if(!delta)return item;
    const point=p=>p&&({x:p.x+delta.x,y:p.y+delta.y});return {...item,start:point(item.start),end:point(item.end),points:item.points?.map(point),obj:{...item.obj,root_x:item.obj.root_x+delta.x,root_y:item.obj.root_y+delta.y}};
   });
   drawExportScene(this.context,report,frame,{...geometry,drawables},resources);}
   this.geometry=geometry;this.preparedFrame=preparedFrame;this.frame=frame;this.signature=signature;this.resources=resources;
  }
  const c=Math.cos(angle)*scale,s=Math.sin(angle)*scale,x=cx+(camera.x??0)-c*cx+s*cy,y=cy+(camera.y??0)-s*cx-c*cy;
  const affine=world?[c*zoom,s*zoom,-s*zoom,c*zoom,(view.x??0)*dpr+x*zoom,(view.y??0)*dpr+y*zoom]:[zoom,0,0,zoom,(view.x??0)*dpr,(view.y??0)*dpr];
  return {report,frame,width,height,affine,stale,plan};
 }
 render(context,options,dpr,resources){
  const prepared=this.#prepare(options,dpr,resources),{report}=prepared;
  if(prepared.stale&&this.paint)applySceneVfx(this.context,prepared.frame,{scale:prepared.width/report.canvas_width,origin:prepared.plan.viewport,outputSize:{width:prepared.width,height:prepared.height},padding:0});
  context.save();try {context.setTransform(...prepared.affine);
  context.beginPath();context.rect(0,0,report.canvas_width,report.canvas_height);context.clip();context.clearRect(0,0,report.canvas_width,report.canvas_height);context.drawImage(this.canvas,prepared.plan?.pad??0,prepared.plan?.pad??0,prepared.width,prepared.height,0,0,report.canvas_width,report.canvas_height);}finally{context.restore();}
 }
 // WebGPU path: the filtered camera image stays a texture, projected by the
 // viewport composite instead of being drawn through a 2D canvas.
 renderTexture(options,dpr,resources,exec){
  const prepared=this.#prepare(options,dpr,resources),{report}=prepared;
  if(prepared.stale){
   const stack=this.paint?activeVfx(vfxStack(prepared.frame)):[],pad=prepared.plan?.pad??0;
   const width=prepared.width+2*pad,height=prepared.height+2*pad;
   if(!fitsVfxSurface(width,height,exec.device.limits.maxTextureDimension2D))throw vfxSurfaceError();
   if(this.filteredWidth!==width||this.filteredHeight!==height){this.filtered?.destroy();this.filteredWidth=width;this.filteredHeight=height;this.filtered=exec.device.createTexture({label:'VFX filtered camera',size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});}
   const out=stack.length?exec.run(this.canvas,stack,{scale:prepared.width/report.canvas_width,origin:{x:-pad,y:-pad},outputSize:{width:prepared.width,height:prepared.height},texture:true}):null;
   const encoder=exec.device.createCommandEncoder();
   if(out)encoder.copyTextureToTexture({texture:out.texture},{texture:this.filtered},[width,height]);
   else exec.device.queue.copyExternalImageToTexture({source:this.canvas},{texture:this.filtered,premultipliedAlpha:true},[prepared.width,prepared.height]);
   exec.device.queue.submit([encoder.finish()]);
   this.filterPad=pad;
  }
  return {texture:this.filtered,pad:this.filterPad??0,surface:{width:prepared.width,height:prepared.height},affine:prepared.affine,report};
 }
 destroy(){releaseGeometryResources(this.context);this.filtered?.destroy();this.canvas.width=this.canvas.height=1;this.geometry=this.preparedFrame=this.frame=this.resources=null;}
}
