import {drawExportScene} from './export-frame-core.mjs';
import {effectiveCamera} from './pivot/background.mjs';
import {layerVisible} from './layers.mjs';
import {releaseGeometryResources} from './pivot/geometry.mjs';
import {applySceneVfx} from './vfx-canvas.mjs';

/** Process the full camera output before projecting into the viewport. Panning
 * cannot change filter neighborhoods or include the surrounding workspace. */
export class CameraVfx {
 constructor({paint}={}){this.paint=paint;this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('2d');}
 render(context,options,dpr,resources){
  const {report,frame,view={},geometry,preparedFrame,hiddenUids,dragTranslations}=options;
  const camera=effectiveCamera(report,frame)??{},scale=camera.scale??1,angle=camera.angle_rad??0,cx=report.canvas_width/2,cy=report.canvas_height/2;
  const world=options.cameraEnabled===false,zoom=(view.scale??1)*dpr,requested=Math.max(.01,zoom*(world?scale:1)),resolution=Math.min(requested,2048/Math.max(report.canvas_width,report.canvas_height));
  const width=Math.max(1,Math.ceil(report.canvas_width*resolution)),height=Math.max(1,Math.ceil(report.canvas_height*resolution));
  const hidden=preparedFrame?preparedFrame.uids.filter(uid=>hiddenUids?.has(uid)):geometry?.orderedObjects?.filter(g=>hiddenUids?.has(g.obj.unique_id)).map(g=>g.obj.unique_id)??[];
  const signature=JSON.stringify([options.resourceRevision,camera,width,height,frame.background_id,frame.background_id_b,frame.background_mix,frame._stykBackgroundColor,hidden,dragTranslations instanceof Map?[...dragTranslations]:dragTranslations]);
  if(this.geometry!==geometry||this.preparedFrame!==preparedFrame||this.frame!==frame||this.signature!==signature||this.resources!==resources){
   if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
   if(this.paint){this.paint(this.context,options,width,height);applySceneVfx(this.context,frame,{scale:width/report.canvas_width,outputSize:{width,height}});}
   else {const drawables=geometry.drawables.filter(item=>!hiddenUids?.has(item.obj.unique_id)&&layerVisible(report,item.obj.unique_id)).map(item=>{
    const delta=dragTranslations?.get?.(item.obj.unique_id)||dragTranslations?.[item.obj.unique_id];if(!delta)return item;
    const point=p=>p&&({x:p.x+delta.x,y:p.y+delta.y});return {...item,start:point(item.start),end:point(item.end),points:item.points?.map(point),obj:{...item.obj,root_x:item.obj.root_x+delta.x,root_y:item.obj.root_y+delta.y}};
   });
   drawExportScene(this.context,report,frame,{...geometry,drawables},resources);}
   this.geometry=geometry;this.preparedFrame=preparedFrame;this.frame=frame;this.signature=signature;this.resources=resources;
  }
  const c=Math.cos(angle)*scale,s=Math.sin(angle)*scale,x=cx+(camera.x??0)-c*cx+s*cy,y=cy+(camera.y??0)-s*cx-c*cy;
  context.save();if(world)context.setTransform(c*zoom,s*zoom,-s*zoom,c*zoom,(view.x??0)*dpr+x*zoom,(view.y??0)*dpr+y*zoom);else context.setTransform(zoom,0,0,zoom,(view.x??0)*dpr,(view.y??0)*dpr);
  context.beginPath();context.rect(0,0,report.canvas_width,report.canvas_height);context.clip();context.clearRect(0,0,report.canvas_width,report.canvas_height);context.drawImage(this.canvas,0,0,report.canvas_width,report.canvas_height);context.restore();
 }
 destroy(){releaseGeometryResources(this.context);this.canvas.width=this.canvas.height=1;this.geometry=this.preparedFrame=this.frame=this.resources=null;}
}
