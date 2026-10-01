import {samplingFixture} from './export-sampling-fixture.mjs';
import {createFrame,createObject,emptyDocument} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';

const MiB=1024*1024;
const check=(condition,message,details)=>{if(!condition)throw Object.assign(Error(message),{details});};
const read=canvas=>{
  const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,copy.width,copy.height).data;
};
function difference(actual,expected){
  let sum=0,max=0,visible=0,alphaSum=0,alphaMax=0,premultipliedSum=0;
  for(let i=0;i<actual.length;i++){
    const d=Math.abs(actual[i]-expected[i]);sum+=d;max=Math.max(max,d);
    if(i%4===3){if(actual[i]>0)visible++;alphaSum+=d;alphaMax=Math.max(alphaMax,d);premultipliedSum+=d;}
    else {const alpha=i-i%4+3;premultipliedSum+=Math.abs(actual[i]*actual[alpha]/255-expected[i]*expected[alpha]/255);}
  }
  return {mean:sum/actual.length,max,visible,alphaMean:alphaSum/(actual.length/4),alphaMax,premultipliedMean:premultipliedSum/actual.length};
}
function resources(renderer){
  return renderer.device?[...new Set(renderer.layout?.map(entry=>entry.texture).filter(Boolean))]:[...renderer.artwork.values()];
}
const rasterCount=renderer=>renderer.stats.rasterizedObjects??0;
const newRasters=(renderer,before)=>renderer.device?rasterCount(renderer):rasterCount(renderer)-before;
const sceneView=(scale,target,width,height)=>({scale,x:width/2-target.x*scale+.31,y:height/2-target.y*scale+.27});

function scene({opaque=false}={}){
  const report=samplingFixture({kind:'outline'}),figure=report.figure_types[0],base=figure.segments[0];
  figure.segment_decode.global_style.u30=opaque?0:80;
  figure.segments=Array.from({length:8},(_,i)=>({...base,segment_id:i+1,parent_id:0,length:180,angle_rad:i*Math.PI/4+.413}));
  figure.segment_count=figure.segments.length;
  const frame=createFrame([createObject(figure,1,200,200)]);report.keyframes=[frame];
  const geometry=buildGeometry(report,frame),item=geometry.drawables[0];
  const target={x:item.start.x+(item.end.x-item.start.x)*.45,y:item.start.y+(item.end.y-item.start.y)*.45};
  if(opaque){
    const dx=item.end.x-item.start.x,dy=item.end.y-item.start.y,length=Math.hypot(dx,dy);
    target.x-=dy/length*item.thickness*.5;target.y+=dx/length*item.thickness*.5;
  }
  return {report,frame,geometry,target};
}

/** In-page regression runner, also usable directly by the collaborative preview.
 * No attached user project is needed or embedded in this fixture. */
export async function zoomGestureState({forceCanvas2D=false,rendererURL='../src/renderer.mjs'}={}){
  const {createRenderer}=await import(rendererURL);
  const width=384,height=256,budget=16*MiB,checks=[],rows=[],errors=[],renderers=[];
  const verify=(condition,message,details)=>{check(condition,message,details);checks.push(message);};
  const make=async extra=>{
    const renderer=await createRenderer(document.createElement('canvas'),{forceCanvas2D,gpuDrawing:false,sharedArtwork:false,editorRasterCache:{maxBytes:budget},...extra});
    renderer.resize(width,height,1);renderer.artworkBudget=budget;
    renderer.device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));
    renderers.push(renderer);return renderer;
  };
  const dispose=owned=>{owned.destroy();renderers.splice(renderers.indexOf(owned),1);};
  const renderer=await make();
  const optionsFor=(s,scale)=>({report:s.report,frame:s.frame,geometry:s.geometry,view:sceneView(scale,s.target,width,height),cameraEnabled:false,clipToCanvas:false,editorBackgroundColor:0x00ffffff});
  const submit=async options=>{renderer.render(options);await renderer.device?.queue.onSubmittedWorkDone();return read(renderer.canvas);};
  const bounded=()=>{
    if(renderer.device){
      verify(renderer.rasterCache.stats.activeBytes<=budget,'Visible gesture artwork stays within its raster allocation');
      verify(renderer.rasterCache.bytes<=budget&&renderer.rasterCache.recycledBytes<=renderer.rasterCache.maxRecycledBytes,'Retained and recycled gesture artwork stay within their existing budgets');
      verify(renderer.rasterCache.leases.size===0,'Synchronous gesture updates retain no preparation leases');
    }else verify(renderer.artworkBytes<=budget,'Canvas gesture artwork stays within its raster allocation');
  };
  const compareFresh=async(options,label,{mean=.02,alphaMax=1}={})=>{
    const fresh=await make();fresh.render({...options,viewChanging:false});await fresh.device?.queue.onSubmittedWorkDone();
    const diff=difference(read(renderer.canvas),read(fresh.canvas));
    const plan=r=>resources(r).map(resource=>({resolution:resource.resolution,raster:resource.raster,bounds:resource.bounds}));
    verify(diff.visible>100&&diff.mean<mean&&diff.alphaMax<=alphaMax,`${label}: settled pixels match an independently prepared scene (${diff.mean.toFixed(4)})`,{diff,actual:plan(renderer),fresh:plan(fresh)});
    rows.push({name:label,backend:renderer.stats.backend,diff});dispose(fresh);
  };
  try{
    const native=scene();
    let options=optionsFor(native,2);await submit(options);
    const whole=resources(renderer),initialRasterCount=rasterCount(renderer);
    verify(whole.length===1&&!whole[0].raster,'Ordinary zoom starts with one complete native artwork raster');
    let changed=0;
    for(const scale of [2.2,2.8,3.4,4.1,5.3,8,12,16]){
      options={...optionsFor(native,scale),viewChanging:true};const before=rasterCount(renderer);await submit(options);
      changed+=newRasters(renderer,before);
      const active=resources(renderer);
      verify(active.length===whole.length&&active.every(resource=>whole.includes(resource)),`${scale}x: covered wheel zoom retains the original artwork`);
    }
    verify(changed===0,'Crossing density buckets during covered zoom performs no new artwork rasterization');
    rows.push({name:'covered zoom',backend:renderer.stats.backend,initialRasterCount,gestureRasters:changed});
    await submit({...options,viewChanging:false});
    await compareFresh(options,'ordinary-to-high zoom');bounded();

    options=optionsFor(native,32);await submit(options);
    const cropped=resources(renderer);
    verify(cropped.length===1&&cropped[0].raster?.cropped,'High zoom starts with bounded, cropped native artwork');
    options={...optionsFor(native,64),viewChanging:true};const beforeIn=rasterCount(renderer);await submit(options);
    verify(newRasters(renderer,beforeIn)===0&&resources(renderer)[0]===cropped[0],'Zooming farther into a covered crop retains its pixels');
    options={...optionsFor(native,16),viewChanging:true};const beforeOut=rasterCount(renderer);await submit(options);
    verify(newRasters(renderer,beforeOut)>0&&resources(renderer)[0]!==cropped[0],'Zooming out of retained coverage prepares newly exposed artwork');
    const beforeMove=resources(renderer)[0];
    options={...options,view:{...options.view,x:options.view.x-220}};await submit(options);
    verify(resources(renderer)[0]!==beforeMove,'Moving beyond a retained crop refreshes newly exposed artwork during the gesture');
    await submit({...options,viewChanging:false});
    // Retaining a legally covered crop can shift native edge antialiasing
    // slightly versus a newly quantized crop. The no-gesture baseline has the
    // same variance (GPU mean .0793 / alpha max 16; Canvas .0746 / 15).
    await compareFresh(options,'exposed crop',{mean:.1,alphaMax:16});bounded();

    const onionFrame=createFrame([createObject(native.report.figure_types[0],1,203,202)]);
    const onionFrames=[{frame:onionFrame,geometry:buildGeometry(native.report,onionFrame),opacity:.35}];
    options={...optionsFor(native,2),onionFrames};await submit(options);
    const onionRasters=renderer.device?resources(renderer):[...renderer.onionArtwork.values()];
    verify(onionRasters.length>0,'Onion-skin setup retains visible artwork');
    for(const scale of [2.4,3.2,4.8,7]){
      options={...optionsFor(native,scale),onionFrames,viewChanging:true};await submit(options);
      const current=renderer.device?resources(renderer):[...renderer.onionArtwork.values()];
      verify(current.length===onionRasters.length&&current.every(resource=>onionRasters.includes(resource)),`${scale}x: onion skins retain their covered artwork during zoom`);
      if(!renderer.device)verify(renderer.stats.onionRasterizedObjects===0,'Covered Canvas onion skins perform no new rasterization');
    }
    await submit({...options,viewChanging:false});
    await compareFresh(options,'onion-skin zoom');bounded();

    // Geometry revisions must override the transient density hold immediately.
    const revised=scene();revised.frame.objects[0].angles[0]+=.18;
    revised.geometry=buildGeometry(revised.report,revised.frame);
    options={...optionsFor(revised,4),viewChanging:true};await submit(options);
    await compareFresh(options,'scene revision during zoom');bounded();
    const beforePlayback=resources(renderer)[0];
    options={...optionsFor(revised,2),viewChanging:true,playing:true};await submit(options);
    verify(resources(renderer)[0]!==beforePlayback,'Playback selects its requested density even when a view gesture is marked active');
    await compareFresh(options,'playback density');bounded();

    if(renderer.device){
      const outline=scene({opaque:true});
      options=optionsFor(outline,16);await submit(options);
      verify(renderer.stats.outlinedVectorObjects===1&&renderer.stats.textureObjects===0,'Supported high-zoom outlines start as sharp vectors');
      await submit({...optionsFor(outline,2),viewChanging:true});
      verify(renderer.stats.outlinedVectorObjects===1&&renderer.stats.textureObjects===0,'A covered gesture keeps high-zoom outline vectors until it settles');
      options=optionsFor(outline,2);await submit(options);
      verify(renderer.stats.outlinedVectorObjects===0&&renderer.stats.textureObjects===1,'Settling at ordinary zoom restores its established native artwork');
      await compareFresh(options,'high-to-ordinary outline transition');
      await submit({...optionsFor(outline,32),viewChanging:true});
      verify(renderer.stats.outlinedVectorObjects===0&&renderer.stats.textureObjects===1,'An ordinary-to-high gesture retains its existing painter');
      options=optionsFor(outline,32);await submit(options);
      verify(renderer.stats.outlinedVectorObjects===1&&renderer.stats.textureObjects===0,'Settling at high zoom restores sharp outline vectors');
      await compareFresh(options,'ordinary-to-high outline transition');bounded();

      const priorGeneration=renderer.generation;
      renderer.invalidateImages(['/zoom-gesture-resource-not-present.png']);
      verify(renderer.generation!==priorGeneration,'A resource lifetime change advances the scene generation');
      await submit({...optionsFor(outline,2),viewChanging:true});
      verify(renderer.stats.outlinedVectorObjects===0&&renderer.stats.textureObjects===1,'A changed resource generation immediately replaces an obsolete held painter');
      await compareFresh(optionsFor(outline,2),'resource generation during zoom');bounded();
    }
    verify(!errors.length,'Gesture reuse and density restoration produce no GPU validation errors');
    const retained=resources(renderer);dispose(renderer);
    verify(renderer.device?renderer.rasterCache.bytes===0&&renderer.rasterCache.leases.size===0:renderer.artworkBytes===0&&renderer.artwork.size===0,'Disposal releases retained gesture artwork');
    verify(retained.every(resource=>resource.destroyed||resource.canvas?.width===1),'Disposed retained artwork cannot be reused');
    return {checks,rows,errors,backend:renderer.stats.backend};
  }finally{for(const owned of renderers)owned.destroy();}
}

/** Live drawing pixels keep their own invalidation contract while zoom is held. */
export async function zoomGestureDrawing({forceCanvas2D=false,rendererURL='../src/renderer.mjs'}={}){
  const {createRenderer}=await import(rendererURL);
  const {createDrawingFigure}=await import('../src/drawing-model.mjs');
  const {DrawingResources}=await import('../src/drawing-resources.mjs');
  const figure=createDrawingFigure(),report=emptyDocument();report.figure_types=[figure];
  const frame=createFrame([createObject(figure,1,0,0)]);report.keyframes=[frame];
  const owner=new DrawingResources(report,{history:false});owner.busy=true;
  const surface=await owner.surface(figure),geometry=buildGeometry(report,frame);
  const renderer=await createRenderer(document.createElement('canvas'),{forceCanvas2D,gpuDrawing:false,resources:{drawing:f=>owner.presenter(f)}});
  renderer.resize(320,240,1);
  const options={report,frame,geometry,view:{x:80,y:60,scale:1},cameraEnabled:false,clipToCanvas:false,vfxEnabled:false,editorBackgroundColor:0x00ffffff};
  const paint=async()=>{renderer.render(options);await renderer.device?.queue.onSubmittedWorkDone();return read(renderer.canvas);};
  const countColor=(pixels,r,g,b)=>{let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===r&&pixels[i+1]===g&&pixels[i+2]===b&&pixels[i+3]===255)count++;return count;};
  const checks=[];
  const verify=(condition,message)=>{check(condition,message);checks.push(message);};
  try{
    surface.store.set(0,0,new Uint8ClampedArray([30,60,220,255]));owner.present(surface,{x:0,y:0,width:64,height:64});
    const original=await paint();verify(countColor(original,30,60,220)>100,'Live drawing setup paints visible editable pixels');
    options.viewChanging=true;options.view={x:80,y:60,scale:1.2};
    const held=await paint();verify(countColor(held,30,60,220)>100,'The drawing remains visible during zoom');
    surface.store.set(0,0,new Uint8ClampedArray([220,30,60,255]));owner.present(surface,{x:0,y:0,width:64,height:64});
    const changed=await paint();
    verify(countColor(changed,220,30,60)>100&&countColor(changed,30,60,220)===0,'Live drawing revisions appear immediately during zoom');
    surface.store.delete(0,0);owner.present(surface,{x:0,y:0,width:64,height:64});
    const erased=await paint();verify(countColor(erased,220,30,60)===0,'Erasing during zoom clears the displayed drawing');
    options.viewChanging=false;await paint();
    return {checks,backend:renderer.stats.backend};
  }finally{renderer.destroy();owner.dispose();}
}
