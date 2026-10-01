import {samplingFixture} from './export-sampling-fixture.mjs';
import {createFrame,createObject} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {createVfx} from '../src/vfx.mjs';

const check=(condition,message,details)=>{if(!condition)throw Object.assign(Error(message),{details});};
const read=canvas=>{
  const copy=new OffscreenCanvas(canvas.width,canvas.height),ctx=copy.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,copy.width,copy.height).data;
};
function difference(actual,expected){
  check(actual.length===expected.length,'Pixel references must have identical dimensions');
  let sum=0,max=0,painted=0,far=0;
  for(let i=0;i<actual.length;i+=4){
    let pixel=0;
    for(let c=0;c<4;c++){const d=Math.abs(actual[i+c]-expected[i+c]);sum+=d;max=Math.max(max,d);pixel=Math.max(pixel,d);}
    if(actual[i]+actual[i+1]+actual[i+2]<765)painted++;if(pixel>24)far++;
  }
  return {mean:sum/actual.length,max,painted,far,pixels:actual.length/4};
}
const effect=(type,id,params={})=>{const value=createVfx(type,id);Object.assign(value.params,params);return value;};
/** Native outlined strokes always paint through Canvas, so their figure effects
 * exercise the artwork route rather than the vector one. */
function scene(effects,{opacity=1}={}){
  const report=samplingFixture({kind:'outline'}),figure=report.figure_types[0],base=figure.segments[0];
  figure.segment_decode.global_style.u30=80;
  figure.segments=Array.from({length:8},(_,i)=>({...base,segment_id:i+1,parent_id:0,length:46,angle_rad:i*Math.PI/4+.413,color_rgb:[40+i*24,170-i*12,220]}));
  figure.segment_count=figure.segments.length;report.canvas_width=256;report.canvas_height=192;
  const object=createObject(figure,1,128.4,96.3,opacity<1?{field28:Math.round((1-opacity)*255)}:{});object._stykVfx=effects;
  const frame=createFrame([object]);report.keyframes=[frame];
  return {report,frame,geometry:buildGeometry(report,frame)};
}
/** Canvas artwork filtered on the presenting device must match the same
 * artwork filtered inside the Canvas painter. Runs in the real WebGPU renderer. */
export async function artworkVfxParity({rendererURL='../src/renderer.mjs',onProgress=()=>{}}={}){
  const {createRenderer}=await import(rendererURL);
  const width=384,height=288,checks=[],rows=[],errors=[],renderers=[];
  const verify=(condition,message,details)=>{check(condition,message,details);checks.push(message);onProgress({checks:checks.length,message});};
  const make=async disableVectorVfx=>{
    const renderer=await createRenderer(document.createElement('canvas'),{gpuDrawing:false,sharedArtwork:false});
    renderer.resize(width,height,1);renderer.disableVectorVfx=disableVectorVfx;renderers.push(renderer);
    renderer.device?.addEventListener('uncapturederror',event=>errors.push(event.error.message));return renderer;
  };
  const cases=[
    ['glow',{figure:[effect('glow','a',{radius:5,intensity:1.2})]}],
    ['blur',{figure:[effect('blur','a',{radius:2.5})]}],
    ['directional blur and glow',{figure:[effect('blur','a',{mode:1,radius:6,angle:54}),effect('glow','b',{radius:8,intensity:1.2})]}],
    ['outline',{figure:[effect('outline','a',{width:1.4,mode:2})]}],
    ['bloom and tint',{figure:[effect('bloom','a',{threshold:.5,radius:6,intensity:1.3}),effect('tint','b',{mix:.4})]}],
    ['half strength',{figure:[effect('blur','a',{radius:3,effectStrength:.48})]}],
  ];
  try{
    const current=await make(false),reference=await make(true);
    verify(current.device&&current.stats.backend==='WebGPU','The artwork effect regression executes the real WebGPU renderer');
    for(const [name,effects] of cases)for(const scale of [1.3,2.6,24]){
      const s=scene(effects),view={scale,x:width/2-128.4*scale+.31,y:height/2-96.3*scale+.27};
      const options={report:s.report,frame:s.frame,geometry:s.geometry,view,cameraEnabled:false,clipToCanvas:false,editorBackgroundColor:0xffffffff};
      const before=current.stats.artworkVfxObjects??0;
      current.render(options);reference.render(options);
      await current.device.queue.onSubmittedWorkDone();await reference.device.queue.onSubmittedWorkDone();
      verify((current.stats.artworkVfxObjects??0)===before+1,`${name} ${scale}x: the figure stack is filtered on the device`);
      verify(!(reference.stats.artworkVfxObjects>0),`${name} ${scale}x: the reference filters inside the Canvas painter`);
      const diff=difference(read(current.canvas),read(reference.canvas));
      // Path-only artwork paints on a software surface here and an accelerated
      // one in the reference; native edges differ slightly before filtering.
      verify(diff.painted>400&&diff.mean<.5&&diff.far<=diff.pixels*.002,`${name} ${scale}x: device-filtered artwork matches Canvas filtering (${diff.mean.toFixed(4)})`,diff);
      rows.push({name,scale,diff});
    }
    // Opacity composites after the effect stack: that order belongs to the Canvas painter.
    const translucent=scene({figure:[effect('glow','a',{radius:5})]},{opacity:.5}),before=current.stats.artworkVfxObjects??0;
    const options={report:translucent.report,frame:translucent.frame,geometry:translucent.geometry,view:{scale:2,x:width/2-128.4*2,y:height/2-96.3*2},cameraEnabled:false,clipToCanvas:false,editorBackgroundColor:0xffffffff};
    current.render(options);reference.render(options);
    await current.device.queue.onSubmittedWorkDone();await reference.device.queue.onSubmittedWorkDone();
    const diff=difference(read(current.canvas),read(reference.canvas));
    verify((current.stats.artworkVfxObjects??0)===before&&diff.painted>400&&diff.max===0,'A translucent figure keeps the complete Canvas painter and exact pixels',diff);
    verify(!errors.length,'Device-filtered artwork produces no GPU validation errors',errors);
    return {checks,rows,errors,backend:current.stats.backend};
  }finally{for(const renderer of renderers)renderer.destroy();}
}
