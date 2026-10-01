import {createRenderer} from '../src/renderer.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {createDrawingFigure} from '../src/drawing-model.mjs';
import {DrawingResources} from '../src/drawing-resources.mjs';
import {drawCameraMonitor} from '../src/camera-monitor.mjs';

const check=(condition,message,details)=>{if(!condition)throw Object.assign(Error(message),{details});};
function pixels(canvas,width=canvas.width,height=canvas.height){return canvas.getContext('2d').getImageData(0,0,width,height).data;}
function compare(a,b){
  let max=0,total=0,changed=0;
  for(let i=0;i<a.length;i+=4)for(let c=0;c<4;c++){
    const difference=Math.abs((c===3?a[i+c]:a[i+c]*a[i+3]/255)-(c===3?b[i+c]:b[i+c]*b[i+3]/255));
    max=Math.max(max,difference);total+=difference;if(difference>=1)changed++;
  }
  return {max,mean:total/a.length,changed};
}
async function renderer(resources={}){
  return createRenderer(document.createElement('canvas'),{forceCanvas2D:true,resources});
}

/** Run directly through the collaborative preview. These checks exercise real
 * Canvas pixels, drawing presenters and prepared surfaces without app startup. */
export async function compatibilityEditorChecks({onProgress=()=>{}}={}){
  const checks=[],rows=[];
  const verify=(condition,message,details)=>{check(condition,message,details);checks.push(message);onProgress({message,details});};
  // The larger reference viewport paints the complete object raster. Sampling
  // its top-left compares ordinary-zoom crops on the same complete pixel grid.
  const figure=defaultFigure(),object=createObject(figure,1,0,0),g={slot:0,obj:object,fig:figure,root:{x:0,y:0}};
  g.drawables=Array.from({length:360},(_,index)=>{
    const x=(index%20)*76+13.37,y=Math.floor(index/20)*54+11.61,start={x,y},end={x:x+31.27,y:y+22.83};
    return {type:'line',slot:0,obj:object,fig:figure,start,end,points:[start,end],length:Math.hypot(31.27,22.83),
      angle:Math.atan2(22.83,31.27),bend:0,thickness:1.17+index%4,opacity:1,alpha:1,rgb:[20,80,150],seg:{segment_kind:index%3?'line':'squareLine'}};
  });
  const far=createObject(figure,2,3000,3000),farFrame=createFrame([far]),farGeometry=buildGeometry({figure_types:[figure]},farFrame).orderedObjects[0];
  const frame=createFrame([object,far]),report={version:5,canvas_width:1700,canvas_height:1200,fps:24,backgrounds:[],figure_types:[figure],keyframes:[frame]};
  const geometry={objects:new Map([[0,g],[1,farGeometry]]),orderedObjects:[g,farGeometry],drawables:[...g.drawables,...farGeometry.drawables],warnings:[]};
  const options={report,frame,geometry,view:{scale:1.25},cameraEnabled:false,vfxEnabled:false,onionFrames:[],clipToCanvas:false};
  onProgress({phase:'ordinary-zoom renderer creation'});
  const candidate=await renderer(),reference=await renderer();
  try{
    onProgress({phase:'ordinary-zoom paints'});
    candidate.resize(320,240,1);reference.resize(2200,1600,1);
    candidate.render(options);reference.render(options);
    const difference=compare(pixels(candidate.canvas),pixels(reference.canvas,320,240)),crop=[...candidate.artwork.values()].find(item=>item.raster?.cropped);
    verify(candidate.stats.culledObjects>=1,'Off-screen figures are culled at ordinary zoom',candidate.stats.culledObjects);
    verify(Boolean(crop)&&crop.bytes<reference.artworkBytes*.6,'Large partly visible artwork keeps a bounded ordinary-zoom crop',{cropBytes:crop?.bytes,completeBytes:reference.artworkBytes});
    verify(difference.max<=2&&difference.mean<.02,'Ordinary-zoom crop matches the complete artwork pixels',difference);
    rows.push({name:'ordinary-zoom-crop',difference,bytes:crop.bytes,completeBytes:reference.artworkBytes});
    // Panning past retained coverage installs fresh pixels, rather than using
    // an invalid crop or silently retaining the previous blank region.
    const moved={...options,view:{scale:1.25,x:-700,y:-500}};
    candidate.render(moved);reference.render(moved);
    const panDifference=compare(pixels(candidate.canvas),pixels(reference.canvas,320,240));
    verify(panDifference.max<=2&&panDifference.mean<.02,'Panning beyond crop coverage restores exact visible artwork',panDifference);
  }finally{candidate.destroy();reference.destroy();}

  const drawing=createDrawingFigure({figureTypeId:2,celId:'cel-compatibility-regression'});
  const objects=Array.from({length:24},(_,i)=>createObject(figure,i+1,40+(i%8)*76,100+Math.floor(i/8)*130));
  objects.splice(12,0,createObject(drawing,100,220,130));
  const mixedFrame=createFrame(objects),mixed={version:5,canvas_width:640,canvas_height:480,fps:24,backgrounds:[],figure_types:[figure,drawing],keyframes:[mixedFrame]};
  const owner=new DrawingResources(mixed,{history:false});owner.busy=true;
  onProgress({phase:'drawing surface preparation'});
  const surface=await owner.surface(drawing);
  onProgress({phase:'drawing renderer creation'});
  const live=await renderer({drawing:f=>owner.presenter(f)}),full=await renderer({drawing:f=>owner.presenter(f)});
  const mixedOptions={report:mixed,frame:mixedFrame,geometry:buildGeometry(mixed,mixedFrame),view:{scale:1},cameraEnabled:false,vfxEnabled:false,onionFrames:[],clipToCanvas:false};
  const translations=new Map([[6,{x:19,y:-7}]]);
  try{
    onProgress({phase:'drawing gesture paints'});
    live.resize(640,480,1);full.resize(640,480,1);
    surface.store.set(0,0,new Uint8ClampedArray([20,80,220,255]));owner.present(surface,{x:0,y:0,width:64,height:64});
    live.render(mixedOptions);live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});
    const before=live.stats.sceneLayerReuses||0;
    translations.set(6,{x:23,y:-3});live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});
    verify((live.stats.sceneLayerReuses||0)>before,'A static drawing cel permits retained gesture layers');
    const builds=live.stats.sceneLayerBuilds||0;
    surface.store.set(0,0,new Uint8ClampedArray([220,30,60,255]));owner.present(surface,{x:0,y:0,width:64,height:64});
    live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});full.render({...mixedOptions,dragTranslations:translations});
    let difference=compare(pixels(live.canvas),pixels(full.canvas));
    verify(difference.max<=2,'Drawing stamp changes replace retained layer pixels immediately',difference);
    verify((live.stats.sceneLayerBuilds||0)>builds,'A changed drawing expands the live painter range');
    const reuses=live.stats.sceneLayerReuses||0;
    surface.store.set(0,0,new Uint8ClampedArray([60,220,30,255]));owner.present(surface,{x:0,y:0,width:64,height:64});
    live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});full.render({...mixedOptions,dragTranslations:translations});
    difference=compare(pixels(live.canvas),pixels(full.canvas));
    verify(difference.max<=2&&(live.stats.sceneLayerReuses||0)>reuses,'Further drawing edits repaint their live range while retaining other layers',difference);
    surface.store.delete(0,0);owner.present(surface,{x:0,y:0,width:64,height:64});
    live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});full.render({...mixedOptions,dragTranslations:translations});
    difference=compare(pixels(live.canvas),pixels(full.canvas));
    verify(difference.max<=2,'Erasing a drawing during a gesture removes its pixels',difference);
    rows.push({name:'drawing-layer-invalidation',difference,builds:live.stats.sceneLayerBuilds,reuses:live.stats.sceneLayerReuses});
    onProgress({phase:'large-display layer paint'});
    // 5,000x4,000 would require 160 MB for two complete retained layers.
    live.resize(5000,4000,1);live.render(mixedOptions);live.render({...mixedOptions,liveEditing:true,dragTranslations:translations});
    verify(live.stats.sceneLayerBytes>0&&live.stats.sceneLayerBytes<=96*1024*1024,'Compact artwork retains bounded layers on a large display',live.stats.sceneLayerBytes);
    const retained=[live.sceneLayers.below.canvas,live.sceneLayers.above.canvas];live.clearSceneLayers();
    verify(retained.every(canvas=>canvas.width===1&&canvas.height===1),'Ending a retained layer lifetime releases its pixel surfaces');
  }finally{live.destroy();full.destroy();owner.dispose();}

  const simpleFrame=createFrame([createObject(figure,1,190,230)]),simple={...mixed,figure_types:[figure],keyframes:[simpleFrame]};
  const prepared=await renderer(),monitor=document.createElement('canvas');monitor.style.cssText='width:320px;height:240px';document.body.append(monitor);
  try{
    onProgress({phase:'prepared monitor paint'});
    prepared.resize(640,480,1);prepared.render({report:simple,frame:simpleFrame,view:{scale:1},cameraEnabled:true,vfxEnabled:false});
    const bitmap=await createImageBitmap(prepared.canvas),key=prepared.prepareFrame({softwareFrames:true,key:'1:0',cameraEnabled:true,hiddenKey:'hidden-2',uids:Uint32Array.of(1),compatibility:[{bitmap}]},{report:simple});bitmap.close();
    const entry=prepared.prepared.get(key),expected=document.createElement('canvas');
    const result=drawCameraMonitor(monitor,{report:simple,frame:simpleFrame,geometry:{get drawables(){throw Error('Prepared camera monitor evaluated figures.');}},
      prepared:{renderer:prepared,key,hiddenKey:'hidden-2'}});
    verify(result,'Compatibility camera monitor presents an admitted frame without evaluating figures');
    expected.width=monitor.width;expected.height=monitor.height;expected.getContext('2d').drawImage(entry.canvas,0,0,monitor.width,monitor.height);
    const difference=compare(pixels(monitor),pixels(expected));verify(difference.max===0,'Prepared compatibility monitor borrows the exact completed frame pixels',difference);
    verify(prepared.renderPreparedInto(key,{report:simple,hiddenKey:'changed',target:{context:monitor.getContext('2d')}})===false,'Prepared compatibility monitor rejects changed visibility');
    verify(prepared.renderPreparedInto(key,{report:simple,hiddenKey:'hidden-2',cameraEnabled:false,target:{context:monitor.getContext('2d')}})===false,'Prepared compatibility monitor rejects a different camera mode');
    rows.push({name:'prepared-software-monitor',difference});
  }finally{prepared.destroy();monitor.remove();}
  return {checks,rows};
}
